import { DEFAULT_GOVERNANCE_CREDITS } from "@code-nest/core";

import type { PrivateBriefSource } from "../../briefing/adapters/buffered-private-brief-channel.js";
import type {
  AuthorizedPatchProposal,
  PatchIntegrationReport,
  PatchIntegrationRequest,
} from "../../integration/domain/integration.js";
import type {
  MatchParticipantRuntime,
  MatchRuntimeTurn,
} from "../../matches/application/ports/one-round-match-ports.js";
import type {
  RoundExecutor,
  RoundWorkRequest,
} from "../../matches/application/ports/three-round-match-ports.js";
import {
  ThreeRoundMatchError,
  type RoundIntegrationResult,
  type RoundParticipantResult,
  type RoundWorkResult,
} from "../../matches/domain/three-round-match.js";
import type {
  ParticipantWorkspace,
  WorkspaceCapture,
} from "../../workspaces/domain/workspace.js";
import type { MatchObservationContext } from "./match-observation-context.js";

interface PendingRound {
  readonly request: RoundWorkRequest;
  readonly proposals: readonly AuthorizedPatchProposal[];
}

export interface ThreeRoundRuntimeFactory {
  createForRun(
    workspace: ParticipantWorkspace,
    observationRunId: string,
  ): Promise<MatchParticipantRuntime>;
}

export interface RoundWorkspaceManager {
  provision(request: {
    readonly runId: string;
    readonly participantIds: readonly string[];
    readonly repositoryPath: string;
    readonly baseRevision: string;
  }): Promise<readonly ParticipantWorkspace[]>;
  capture(workspace: ParticipantWorkspace): Promise<WorkspaceCapture>;
  cleanup(runId: string): Promise<void>;
}

export interface RoundPatchIntegrator {
  integrate(request: PatchIntegrationRequest): Promise<PatchIntegrationReport>;
}

export interface ContainedOmpThreeRoundRunnerOptions {
  readonly maximumOutputTokens: number;
  readonly wallTimeMilliseconds: number;
}

function rejected(message: string, cause?: unknown): ThreeRoundMatchError {
  return new ThreeRoundMatchError("ROUND_RESULT_REJECTED", message, cause);
}

function settled<T>(
  results: readonly PromiseSettledResult<T>[],
  message: string,
): T[] {
  const failures = results.flatMap((result) =>
    result.status === "rejected" ? [result.reason] : []
  );
  if (failures.length > 0) throw rejected(message, new AggregateError(failures));
  return results.flatMap((result) =>
    result.status === "fulfilled" ? [result.value] : []
  );
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
    throw rejected(
      `Runtime result for ${participantId} does not match its captured workspace.`,
    );
  }
}

export class ContainedOmpThreeRoundRunner implements RoundExecutor {
  readonly #pending = new Map<string, PendingRound>();

  constructor(
    private readonly workspaces: RoundWorkspaceManager,
    private readonly runtimes: ThreeRoundRuntimeFactory,
    private readonly briefs: PrivateBriefSource,
    private readonly integrator: RoundPatchIntegrator,
    private readonly context: MatchObservationContext,
    private readonly options: ContainedOmpThreeRoundRunnerOptions,
  ) {}

  async runWork(request: RoundWorkRequest): Promise<RoundWorkResult> {
    const roundId = `${request.runId}-round-${request.round}`;
    this.context.enter(request.round, "work");
    const workspaces = await this.workspaces.provision({
      runId: roundId,
      participantIds: request.participants.map(({ participantId }) => participantId),
      repositoryPath: request.repositoryPath,
      baseRevision: request.baseRevision,
    });
    const active = new Map<string, MatchParticipantRuntime>();
    try {
      await this.#start(request, workspaces, active);
      const completed = settled(await Promise.allSettled(
        workspaces.map((workspace) => this.#complete(request, workspace, active)),
      ), `One or more runtimes failed during round ${request.round}.`);
      const proposals = completed.map(({ workspace, capture }) => ({
        proposalId: `proposal-r${request.round}-${workspace.participantId}`,
        participantId: workspace.participantId,
        sourceRepositoryPath: workspace.path,
        baseRevision: capture.baseRevision,
        candidateRevision: capture.candidateRevision,
      }));
      const participants = completed.map(({ workspace, turn, capture }) => ({
        participantId: workspace.participantId,
        proposalId: `proposal-r${request.round}-${workspace.participantId}`,
        candidateRevision: capture.candidateRevision,
        commitSummary: turn.commitSummary,
        publicMessages: [...turn.publicMessages],
      } satisfies RoundParticipantResult));
      this.#pending.set(roundId, { request, proposals });
      return {
        roundId,
        round: request.round,
        baseRevision: request.baseRevision,
        participants,
      };
    } catch (error: unknown) {
      await Promise.allSettled(
        [...active.values()].map((runtime) => runtime.stop("controller_fault")),
      );
      await this.workspaces.cleanup(roundId);
      throw error;
    }
  }

  async integrate(roundId: string): Promise<RoundIntegrationResult> {
    const pending = this.#pending.get(roundId);
    if (pending === undefined) throw rejected("Round proposals are unavailable.");
    this.context.enter(pending.request.round, "integration");
    try {
      const report = await this.integrator.integrate({
        runId: roundId,
        baseRepositoryPath: pending.request.repositoryPath,
        baseRevision: pending.request.baseRevision,
        proposals: pending.proposals,
        proposalOrder: pending.proposals.map(({ proposalId }) => proposalId),
      });
      const activeParticipantIds = pending.request.participants.map(
        ({ participantId }) => participantId,
      );
      return {
        roundId,
        round: pending.request.round,
        baseRevision: report.baseRevision,
        candidatePath: report.candidatePath,
        candidateRevision: report.candidateRevision,
        outcomes: report.outcomes,
        governance: {
          initialCredits: DEFAULT_GOVERNANCE_CREDITS,
          creditsSpent: 0,
          activeParticipantIds,
          quarantinedParticipantIds: [],
        },
      };
    } finally {
      this.#pending.delete(roundId);
      await this.workspaces.cleanup(roundId);
    }
  }

  async #start(
    request: RoundWorkRequest,
    workspaces: readonly ParticipantWorkspace[],
    active: Map<string, MatchParticipantRuntime>,
  ): Promise<void> {
    settled(await Promise.allSettled(workspaces.map(async (workspace) => {
      const runtime = await this.runtimes.createForRun(workspace, request.runId);
      if (runtime.participantId !== workspace.participantId) {
        throw rejected("Runtime factory returned a participant identity mismatch.");
      }
      await runtime.start({
        runId: request.runId,
        scenarioId: request.scenarioId,
        workspacePath: workspace.path,
      });
      active.set(workspace.participantId, runtime);
      await runtime.deliverBrief(
        this.briefs.read(request.runId, workspace.participantId),
      );
    })), `One or more runtimes failed to start round ${request.round}.`);
  }

  async #complete(
    request: RoundWorkRequest,
    workspace: ParticipantWorkspace,
    active: ReadonlyMap<string, MatchParticipantRuntime>,
  ) {
    const runtime = active.get(workspace.participantId);
    if (runtime === undefined) throw rejected("Participant runtime disappeared.");
    let turn: MatchRuntimeTurn | undefined;
    let failure: unknown;
    try {
      turn = await runtime.run(this.options);
    } catch (error: unknown) {
      failure = error;
    }
    try {
      await runtime.stop(failure === undefined ? "round_completed" : "controller_fault");
    } catch (error: unknown) {
      failure = failure === undefined ? error : new AggregateError([failure, error]);
    }
    if (failure !== undefined || turn === undefined) throw failure;
    const capture = await this.workspaces.capture(workspace);
    verifyTurn(workspace.participantId, turn, capture.candidateRevision);
    return { workspace, turn, capture };
  }
}
