import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import {
  FakeRuntimeAdapter,
  type RuntimeMetadata,
  type TurnResult,
} from "../../packages/adapters/src/index.js";
import {
  advanceTownHall,
  createTownHall,
  type TownHallPass,
  type TownHallState,
} from "../../packages/core/src/index.js";
import type { PatchIntegrator } from "../../apps/controller/src/integration/application/patch-integrator.js";
import type { WorkspaceManager } from "../../apps/controller/src/workspaces/application/workspace-manager.js";
import type {
  RoundExecutor,
  RoundTownHallRecorder,
  RoundWorkRequest,
} from "../../apps/controller/src/matches/application/ports/three-round-match-ports.js";
import type {
  RoundIntegrationResult,
  RoundWorkResult,
} from "../../apps/controller/src/matches/domain/three-round-match.js";
import type { AuthorizedPatchProposal } from "../../apps/controller/src/integration/domain/integration.js";
import { STATION_ACCESS_WORK } from "./station-access-fake-runtime.js";

const execFileAsync = promisify(execFile);
const COMMIT_DATE = "2001-01-01T00:00:00Z";

const METADATA: RuntimeMetadata = {
  adapterName: "fake",
  adapterVersion: "1.0.0",
  runtimeName: "station-access-three-round-fixture",
  runtimeVersion: "1.0.0",
  modelProvider: "none",
  modelName: "scripted",
  executionMode: "split",
  observabilityTier: 1,
  capabilities: ["typed_tool_events", "usage_accounting"],
};

interface PendingRound {
  readonly request: RoundWorkRequest;
  readonly proposals: readonly AuthorizedPatchProposal[];
}

async function git(workspacePath: string, arguments_: readonly string[]): Promise<string> {
  const result = await execFileAsync("git", [...arguments_], {
    cwd: workspacePath,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_SYSTEM: "/dev/null",
      GIT_AUTHOR_DATE: COMMIT_DATE,
      GIT_COMMITTER_DATE: COMMIT_DATE,
    },
  });
  return result.stdout;
}

async function performRoundOneWork(workspacePath: string, participantId: string) {
  const work = STATION_ACCESS_WORK[participantId];
  if (work === undefined) throw new Error(`No fake work exists for ${participantId}.`);
  await writeFile(join(workspacePath, work.path), work.contents, "utf8");
  await git(workspacePath, ["add", "--", work.path]);
  await git(workspacePath, ["commit", "--quiet", "-m", work.summary]);
  return work.summary;
}

export class FakeThreeRoundRunner implements RoundExecutor {
  readonly transcripts = new Map<string, readonly string[]>();
  readonly #pending = new Map<string, PendingRound>();

  constructor(
    private readonly workspaces: WorkspaceManager,
    private readonly integrator: PatchIntegrator,
  ) {}

  async runWork(request: RoundWorkRequest): Promise<RoundWorkResult> {
    const roundId = `${request.runId}-round-${request.round}`;
    const workspaces = await this.workspaces.provision({
      runId: roundId,
      participantIds: request.participants.map(({ participantId }) => participantId),
      repositoryPath: request.repositoryPath,
      baseRevision: request.baseRevision,
    });
    try {
      const participants = [];
      const proposals: AuthorizedPatchProposal[] = [];
      for (const workspace of workspaces) {
        const assignment = request.participants.find(
          ({ participantId }) => participantId === workspace.participantId,
        );
        if (assignment === undefined) throw new Error("Fake round assignment is missing.");
        const commitSummary = request.round === 1
          ? await performRoundOneWork(workspace.path, workspace.participantId)
          : `Reviewed ${assignment.assignmentId} in round ${request.round}`;
        const revision = (await git(workspace.path, ["rev-parse", "HEAD"])).trim();
        const publicMessage = `${workspace.participantId} completed round ${request.round} review.`;
        const turn: TurnResult = {
          messages: [{
            messageId: `message-r${request.round}-${workspace.participantId}`,
            channel: "public",
            body: publicMessage,
            recipientIds: [],
          }],
          commands: [],
          commits: [{ revision, summary: commitSummary }],
          toolSummary: {
            toolCallCount: request.round === 1 ? 2 : 1,
            tools: request.round === 1 ? ["edit_file", "run_tests"] : ["run_tests"],
          },
          usage: { inputTokens: 100, outputTokens: 50, wallTimeMilliseconds: 250 },
          status: "completed",
        };
        const adapter = new FakeRuntimeAdapter({
          metadata: METADATA,
          sessionId: `session-r${request.round}-${workspace.participantId}`,
          turns: [turn],
        });
        await adapter.start({
          match: { runId: request.runId, scenarioId: request.scenarioId },
          participant: { participantId: workspace.participantId },
          workspace: { path: workspace.path },
        });
        const result = await adapter.run({
          maximumOutputTokens: 4_000,
          wallTimeMilliseconds: 60_000,
        });
        await adapter.stop("round_completed");
        this.transcripts.set(
          `${request.round}-${workspace.participantId}`,
          adapter.transcript().map(({ operation }) => operation),
        );
        const capture = await this.workspaces.capture(workspace);
        if (result.commits[0]?.revision !== capture.candidateRevision) {
          throw new Error("Fake turn does not match its captured workspace.");
        }
        const proposalId = `proposal-r${request.round}-${workspace.participantId}`;
        participants.push({
          participantId: workspace.participantId,
          proposalId,
          candidateRevision: capture.candidateRevision,
          commitSummary,
          publicMessages: [publicMessage],
        });
        proposals.push({
          proposalId,
          participantId: workspace.participantId,
          sourceRepositoryPath: workspace.path,
          baseRevision: capture.baseRevision,
          candidateRevision: capture.candidateRevision,
        });
      }
      this.#pending.set(roundId, { request, proposals });
      return {
        roundId,
        round: request.round,
        baseRevision: request.baseRevision,
        participants,
      };
    } catch (error: unknown) {
      await this.workspaces.cleanup(roundId);
      throw error;
    }
  }

  async runTownHall(
    roundId: string,
    recorder: RoundTownHallRecorder,
  ): Promise<void> {
    const pending = this.#pending.get(roundId);
    if (pending === undefined) throw new Error("Fake round is unavailable for Town Hall.");
    const speakingOrder = pending.request.participants.map(
      ({ participantId }) => participantId,
    );
    await recorder.record({
      type: "town_hall_started",
      round: pending.request.round,
      speakingOrder,
    });
    let state: TownHallState = createTownHall(pending.request.round, speakingOrder);
    for (const pass of ["evidence_accusation", "defence_rebuttal"] as TownHallPass[]) {
      for (const participantId of speakingOrder) {
        const result = advanceTownHall(state, {
          turnId: `round-${pending.request.round}-${pass}-${participantId}`,
          expectedPass: pass,
          participantId,
          message: `${participantId} completed ${pass.replaceAll("_", " ")} review.`,
          citations: [],
        }, []);
        state = result.state;
        await recorder.record({
          type: "town_hall_turn_recorded",
          round: pending.request.round,
          turn: result.turn,
        });
      }
    }
  }

  async integrate(roundId: string): Promise<RoundIntegrationResult> {
    const pending = this.#pending.get(roundId);
    if (pending === undefined) throw new Error("Fake round is unavailable for integration.");
    try {
      const report = await this.integrator.integrate({
        runId: roundId,
        baseRepositoryPath: pending.request.repositoryPath,
        baseRevision: pending.request.baseRevision,
        proposals: pending.proposals,
        proposalOrder: pending.proposals.map(({ proposalId }) => proposalId),
      });
      return {
        roundId,
        round: pending.request.round,
        baseRevision: report.baseRevision,
        candidatePath: report.candidatePath,
        candidateRevision: report.candidateRevision,
        outcomes: report.outcomes,
        governance: {
          initialCredits: 18,
          creditsSpent: 0,
          activeParticipantIds: pending.request.participants.map(
            ({ participantId }) => participantId,
          ),
          quarantinedParticipantIds: [],
        },
      };
    } finally {
      this.#pending.delete(roundId);
      await this.workspaces.cleanup(roundId);
    }
  }
}
