import {
  ONE_ROUND_MATCH_SCHEMA_VERSION,
  OneRoundMatchError,
  validateOneRoundMatchRequest,
  type OneRoundMatchRequest,
  type OneRoundMatchResult,
  type ReplayableIntegrationReport,
} from "../domain/one-round-match.js";
import type {
  MatchParticipantRuntime,
  MatchRuntimeTurn,
  MatchBriefing,
  MatchIntegrator,
  MatchRunLifecycle,
  MatchRuntimeFactory,
  MatchWorkspaceManager,
  IntegrationReportPublisher,
  OneRoundEvidenceRecorder,
} from "./ports/one-round-match-ports.js";

export interface OneRoundMatchDependencies {
  readonly lifecycle: MatchRunLifecycle;
  readonly workspaces: MatchWorkspaceManager;
  readonly runtimes: MatchRuntimeFactory;
  readonly briefing: MatchBriefing;
  readonly integrator: MatchIntegrator;
  readonly reports: IntegrationReportPublisher;
  readonly evidence: OneRoundEvidenceRecorder;
}

const TURN_BUDGET = {
  maximumOutputTokens: 4_000,
  wallTimeMilliseconds: 60_000,
} as const;

function proposalId(participantId: string): string {
  return `proposal-${participantId}`;
}

function replayableReport(
  report: Awaited<ReturnType<MatchIntegrator["integrate"]>>,
): ReplayableIntegrationReport {
  return {
    schemaVersion: "1.0",
    runId: report.runId,
    baseRevision: report.baseRevision,
    candidateRevision: report.candidateRevision,
    outcomes: report.outcomes.map((outcome) => ({ ...outcome })),
  };
}

function verifyTurn(
  participantId: string,
  turn: MatchRuntimeTurn,
  capturedRevision: string,
): void {
  if (
    turn.candidateRevision !== capturedRevision ||
    turn.commitSummary.trim().length === 0 ||
    turn.publicMessages.some((message) => message.trim().length === 0)
  ) {
    throw new OneRoundMatchError(
      "RUNTIME_RESULT_REJECTED",
      `Runtime result for ${participantId} does not match its captured workspace.`,
    );
  }
}

function settledValues<T>(
  results: readonly PromiseSettledResult<T>[],
  message: string,
): T[] {
  const errors = results.flatMap((result) =>
    result.status === "rejected" ? [result.reason] : []
  );
  if (errors.length > 0) throw new AggregateError(errors, message);
  return results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
}

export class OneRoundMatchService {
  constructor(private readonly dependencies: OneRoundMatchDependencies) {}

  async run(input: OneRoundMatchRequest): Promise<OneRoundMatchResult> {
    const request = validateOneRoundMatchRequest(input);
    this.dependencies.lifecycle.create(request.runId, "match-create");

    const workspaces = await this.dependencies.workspaces.provision({
      runId: request.runId,
      participantIds: request.participants.map(({ participantId }) => participantId),
      repositoryPath: request.scenario.repositoryPath,
      baseRevision: request.scenario.baseRevision,
    });
    await this.dependencies.evidence.record(request.runId, {
      type: "workspaces_ready",
      participantIds: workspaces.map(({ participantId }) => participantId),
      baseRevision: request.scenario.baseRevision,
    });

    const runtimes = new Map<string, MatchParticipantRuntime>();
    try {
      const startedRuntimes = settledValues(await Promise.allSettled(
        workspaces.map(async (workspace) => {
          const runtime = await this.dependencies.runtimes.create(workspace);
          if (runtime.participantId !== workspace.participantId) {
            throw new OneRoundMatchError(
              "RUNTIME_RESULT_REJECTED",
              "Runtime factory returned a participant identity mismatch.",
            );
          }
          const started = await runtime.start({
            runId: request.runId,
            scenarioId: request.scenario.scenarioId,
            workspacePath: workspace.path,
          });
          runtimes.set(workspace.participantId, runtime);
          return { workspace, started };
        }),
      ), "One or more participant runtimes failed to start.");
      for (const { workspace, started } of startedRuntimes) {
        await this.dependencies.evidence.record(request.runId, {
          type: "runtime_started",
          participantId: workspace.participantId,
          sessionId: started.sessionId,
          descriptor: started.descriptor,
        });
      }

      await this.dependencies.briefing.brief({
        runId: request.runId,
        roleSeed: request.roleSeed,
        publicTask: request.scenario.publicTask,
        safetyBrief: request.scenario.safetyBrief,
        covertObjectiveSource: request.scenario.covertObjectiveSource,
        participants: request.participants.map((participant) => ({
          participantId: participant.participantId,
          assignment: {
            id: participant.assignmentId,
            instructions: participant.assignmentInstructions,
          },
        })),
      }, runtimes);

      const completedTurns = settledValues(await Promise.allSettled(
        workspaces.map(async (workspace) => {
          const runtime = runtimes.get(workspace.participantId);
          if (runtime === undefined) {
            throw new OneRoundMatchError(
              "RUNTIME_RESULT_REJECTED",
              "Participant runtime disappeared before its turn.",
            );
          }
          const turn = await runtime.run(TURN_BUDGET);
          const stopped = await runtime.stop("round_completed");
          const capture = await this.dependencies.workspaces.capture(workspace);
          verifyTurn(workspace.participantId, turn, capture.candidateRevision);
          return { workspace, turn, stopped, capture };
        }),
      ), "One or more participant runtimes failed to complete work.");
      const participantResults = [];
      const proposals = [];
      for (const { workspace, turn, stopped, capture } of completedTurns) {
        await this.dependencies.evidence.record(request.runId, {
          type: "runtime_stopped",
          participantId: workspace.participantId,
          turnsCompleted: stopped.turnsCompleted,
        });
        await this.dependencies.evidence.record(request.runId, {
          type: "work_captured",
          participantId: workspace.participantId,
          turn,
        });
        const id = proposalId(workspace.participantId);
        participantResults.push({
          participantId: workspace.participantId,
          candidateRevision: capture.candidateRevision,
          proposalId: id,
        });
        proposals.push({
          proposalId: id,
          participantId: workspace.participantId,
          sourceRepositoryPath: workspace.path,
          baseRevision: capture.baseRevision,
          candidateRevision: capture.candidateRevision,
        });
      }

      const report = await this.dependencies.integrator.integrate({
        runId: request.runId,
        baseRepositoryPath: request.scenario.repositoryPath,
        baseRevision: request.scenario.baseRevision,
        proposals,
        proposalOrder: proposals.map(({ proposalId: id }) => id),
      });
      const replayReport = replayableReport(report);
      const reportDigest = await this.dependencies.reports.publish(replayReport);
      await this.dependencies.evidence.record(request.runId, {
        type: "integration_completed",
        report: replayReport,
        reportDigest,
      });
      await this.dependencies.evidence.record(request.runId, {
        type: "match_completed",
        candidateRevision: report.candidateRevision,
      });

      return {
        schemaVersion: ONE_ROUND_MATCH_SCHEMA_VERSION,
        runId: request.runId,
        candidatePath: report.candidatePath,
        candidateRevision: report.candidateRevision,
        integrationReportDigest: reportDigest,
        participants: participantResults,
      };
    } catch (error: unknown) {
      await Promise.allSettled(
        [...runtimes.values()].map((runtime) => runtime.stop("controller_fault")),
      );
      throw error;
    }
  }
}
