import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import type { RuntimeMetadata } from "../../packages/adapters/src/index.js";
import type { PatchIntegrator } from "../../apps/controller/src/integration/application/patch-integrator.js";
import type {
  RoundExecutor,
  RoundTownHallRecorder,
  RoundWorkRequest,
} from "../../apps/controller/src/matches/application/ports/three-round-match-ports.js";
import {
  advanceTownHall,
  createTownHall,
  type TownHallPass,
  type TownHallState,
} from "../../packages/core/src/index.js";
import type {
  RoundIntegrationResult,
  RoundWorkResult,
} from "../../apps/controller/src/matches/domain/three-round-match.js";
import type { AuthorizedPatchProposal } from "../../apps/controller/src/integration/domain/integration.js";
import type { WorkspaceManager } from "../../apps/controller/src/workspaces/application/workspace-manager.js";
import type { RuntimeSessionAudit } from "../../apps/controller/src/matches/application/ports/runtime-session-audit.js";
import { STATION_ACCESS_WORK } from "./station-access-fake-runtime.js";
import {
  runAdapterSession,
  type FixtureWriteCommand,
} from "./heterogeneous-adapter-session.js";
import {
  HeterogeneousIsolationFactory,
  type HeterogeneousManifest,
  type IsolatedParticipantSession,
} from "./heterogeneous-isolation.js";

const executeFile = promisify(execFile);
const COMMIT_DATE = "2001-01-01T00:00:00Z";

interface PendingRound {
  readonly request: RoundWorkRequest;
  readonly proposals: readonly AuthorizedPatchProposal[];
}

export interface HeterogeneousSessionRecord {
  readonly round: number;
  readonly participantId: string;
  readonly sessionId: string;
  readonly metadata: RuntimeMetadata;
  readonly manifest: HeterogeneousManifest;
}

function mode(participantId: string): "contained" | "split" {
  return participantId === "player-a" || participantId === "player-c"
    ? "split"
    : "contained";
}

async function git(workspacePath: string, arguments_: readonly string[]): Promise<string> {
  const result = await executeFile("git", [...arguments_], {
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

function commandFor(participantId: string, round: number): FixtureWriteCommand | null {
  const work = STATION_ACCESS_WORK[participantId];
  if (work === undefined) throw new Error(`No Station Access work exists for ${participantId}.`);
  return round === 1
    ? { kind: "fixture.write", path: work.path, contents: work.contents }
    : null;
}

function participantContainerId(manifest: HeterogeneousManifest): string {
  return manifest.executionMode === "split"
    ? manifest.containerId
    : manifest.participantContainerId;
}

export class HeterogeneousThreeRoundRunner implements RoundExecutor {
  readonly sessions: HeterogeneousSessionRecord[] = [];
  readonly #pending = new Map<string, PendingRound>();

  constructor(
    private readonly workspaces: WorkspaceManager,
    private readonly integrator: PatchIntegrator,
    private readonly isolation: HeterogeneousIsolationFactory,
    private readonly audit: RuntimeSessionAudit,
  ) {}

  async runWork(request: RoundWorkRequest): Promise<RoundWorkResult> {
    const roundId = `${request.runId}-round-${request.round}`;
    const workspaces = await this.workspaces.provision({
      runId: roundId,
      participantIds: request.participants.map(({ participantId }) => participantId),
      repositoryPath: request.repositoryPath,
      baseRevision: request.baseRevision,
    });
    const isolated = new Map<string, IsolatedParticipantSession>();
    try {
      for (const workspace of workspaces) {
        isolated.set(workspace.participantId, await this.isolation.start({
          runId: request.runId,
          round: request.round,
          participantId: workspace.participantId,
          workspacePath: workspace.path,
          mode: mode(workspace.participantId),
        }));
      }

      const participants = [];
      const proposals: AuthorizedPatchProposal[] = [];
      for (const workspace of workspaces) {
        const boundary = isolated.get(workspace.participantId);
        const assignment = request.participants.find(
          ({ participantId }) => participantId === workspace.participantId,
        );
        if (boundary === undefined || assignment === undefined) {
          throw new Error("Heterogeneous round assignment is missing.");
        }
        const command = commandFor(workspace.participantId, request.round);
        const adapter = await runAdapterSession({
          runId: request.runId,
          scenarioId: request.scenarioId,
          participantId: workspace.participantId,
          workspacePath: workspace.path,
          round: request.round,
          mode: mode(workspace.participantId),
          command,
        });
        if (adapter.metadata.executionMode !== boundary.manifest.executionMode) {
          throw new Error("Adapter metadata does not match its isolation boundary.");
        }
        if (adapter.turn.status !== "completed") {
          throw new Error("Heterogeneous adapter did not complete its turn.");
        }
        if (command === null) await boundary.reviewSeed();
        else {
          const returned = adapter.turn.commands[0];
          if (JSON.stringify(returned) !== JSON.stringify(command)) {
            throw new Error("Adapter command changed before isolated execution.");
          }
          const captured = await boundary.captureWrite(command.path, command.contents);
          if (captured !== command.contents) throw new Error("Isolated work capture changed bytes.");
          await writeFile(join(workspace.path, command.path), captured, "utf8");
          await git(workspace.path, ["add", "--", command.path]);
          await git(workspace.path, ["commit", "--quiet", "-m", STATION_ACCESS_WORK[workspace.participantId]?.summary ?? "work"]);
        }
        const session = {
          round: request.round,
          participantId: workspace.participantId,
          sessionId: adapter.sessionId,
          metadata: adapter.metadata,
          manifest: boundary.manifest,
        };
        this.sessions.push(structuredClone(session));
        await this.audit.record(request.runId, {
          round: session.round,
          participantId: session.participantId,
          sessionId: session.sessionId,
          descriptor: session.metadata,
        });
        const capture = await this.workspaces.capture(workspace);
        const proposalId = `proposal-r${request.round}-${workspace.participantId}`;
        participants.push({
          participantId: workspace.participantId,
          proposalId,
          candidateRevision: capture.candidateRevision,
          commitSummary: command === null
            ? `Reviewed ${assignment.assignmentId} in round ${request.round}`
            : STATION_ACCESS_WORK[workspace.participantId]?.summary ?? "Completed work",
          publicMessages: adapter.turn.messages
            .filter(({ channel }) => channel === "public")
            .map(({ body }) => body),
        });
        proposals.push({
          proposalId,
          participantId: workspace.participantId,
          sourceRepositoryPath: workspace.path,
          baseRevision: capture.baseRevision,
          candidateRevision: capture.candidateRevision,
        });
      }
      await Promise.all([...isolated.values()].map((session) => session.stop()));
      expectUniqueContainerIds(this.sessions.filter(({ round }) => round === request.round));
      this.#pending.set(roundId, { request, proposals });
      return { roundId, round: request.round, baseRevision: request.baseRevision, participants };
    } catch (error: unknown) {
      await Promise.allSettled([...isolated.values()].map((session) => session.stop()));
      await this.workspaces.cleanup(roundId);
      throw error;
    }
  }

  async runTownHall(
    roundId: string,
    recorder: RoundTownHallRecorder,
  ): Promise<void> {
    const pending = this.#pending.get(roundId);
    if (pending === undefined) throw new Error("Heterogeneous round is unavailable.");
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
    if (pending === undefined) throw new Error("Heterogeneous round is unavailable.");
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
          activeParticipantIds: pending.request.participants.map(({ participantId }) => participantId),
          quarantinedParticipantIds: [],
        },
      };
    } finally {
      this.#pending.delete(roundId);
      await this.workspaces.cleanup(roundId);
    }
  }
}

function expectUniqueContainerIds(records: readonly HeterogeneousSessionRecord[]): void {
  const ids = records.map(({ manifest }) => participantContainerId(manifest));
  if (new Set(ids).size !== records.length) {
    throw new Error("Participants did not receive distinct isolation containers.");
  }
}
