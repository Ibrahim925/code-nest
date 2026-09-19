import { describe, expect, it } from "vitest";

import type { PrivateRoleBrief } from "../../briefing/domain/brief.js";
import type { PatchIntegrationRequest } from "../../integration/domain/integration.js";
import type {
  MatchParticipantRuntime,
  MatchRuntimeDescriptor,
} from "../../matches/application/ports/one-round-match-ports.js";
import type { RoundWorkRequest } from "../../matches/application/ports/three-round-match-ports.js";
import type {
  ParticipantWorkspace,
  WorkspaceCapture,
} from "../../workspaces/domain/workspace.js";
import {
  ContainedOmpThreeRoundRunner,
  type RoundPatchIntegrator,
  type RoundWorkspaceManager,
  type ThreeRoundRuntimeFactory,
} from "./contained-omp-three-round-runner.js";
import { MatchObservationContext } from "./match-observation-context.js";

const BASE = "a".repeat(40);
const CANDIDATE = "f".repeat(40);
const IDS = ["player-a", "player-b", "player-c", "player-d"] as const;
const DESCRIPTOR: MatchRuntimeDescriptor = {
  adapterName: "omp-rpc",
  adapterVersion: "1.0.0",
  runtimeName: "omp",
  runtimeVersion: "18.1.14",
  modelProvider: "code-nest-openai",
  modelName: "gpt-5.6-luna",
  executionMode: "contained",
  observabilityTier: 2,
  capabilities: [],
};

function workspace(participantId: string): ParticipantWorkspace {
  return {
    schemaVersion: "1.0",
    runId: "match-1-round-2",
    participantId,
    path: `/workspaces/match-1-round-2/${participantId}`,
    baseRevision: BASE,
  };
}

function capture(value: ParticipantWorkspace): WorkspaceCapture {
  return {
    schemaVersion: "1.0",
    runId: value.runId,
    participantId: value.participantId,
    baseRevision: BASE,
    candidateRevision: CANDIDATE,
    commits: [],
    trackedPatch: new Uint8Array(),
    untrackedFiles: [],
  };
}

class FakeWorkspaces implements RoundWorkspaceManager {
  readonly cleaned: string[] = [];

  async provision(request: { readonly participantIds: readonly string[] }) {
    return request.participantIds.map(workspace);
  }

  async capture(value: ParticipantWorkspace) {
    return capture(value);
  }

  async cleanup(runId: string) {
    this.cleaned.push(runId);
  }
}

class FakeRuntime implements MatchParticipantRuntime {
  readonly operations: string[] = [];

  constructor(readonly participantId: string) {}

  async start(request: { readonly runId: string }) {
    this.operations.push(`start:${request.runId}`);
    return { sessionId: `session-${this.participantId}`, descriptor: DESCRIPTOR };
  }

  async deliverBrief(brief: PrivateRoleBrief) {
    this.operations.push(`brief:${brief.runId}:${brief.assignment.id}`);
  }

  async run() {
    this.operations.push("run");
    return {
      status: "completed" as const,
      candidateRevision: CANDIDATE,
      commitSummary: `Reviewed ${this.participantId}`,
      publicMessages: [`${this.participantId} is ready.`],
      usage: null,
    };
  }

  async stop(reason: string) {
    this.operations.push(`stop:${reason}`);
    return { sessionId: `session-${this.participantId}`, turnsCompleted: 1 };
  }
}

class FakeRuntimes implements ThreeRoundRuntimeFactory {
  readonly runtimes = new Map<string, FakeRuntime>();
  readonly observationRuns: string[] = [];

  async createForRun(value: ParticipantWorkspace, observationRunId: string) {
    this.observationRuns.push(observationRunId);
    const runtime = new FakeRuntime(value.participantId);
    this.runtimes.set(value.participantId, runtime);
    return runtime;
  }
}

class FakeIntegrator implements RoundPatchIntegrator {
  request: PatchIntegrationRequest | undefined;

  async integrate(request: PatchIntegrationRequest) {
    this.request = request;
    return {
      schemaVersion: "1.0" as const,
      runId: request.runId,
      baseRevision: request.baseRevision,
      candidateRevision: CANDIDATE,
      candidatePath: "/releases/match-1-round-2",
      outcomes: request.proposals.map((proposal) => ({
        proposalId: proposal.proposalId,
        participantId: proposal.participantId,
        status: "integrated" as const,
        normalizedPatchDigest: `sha256:${"1".repeat(64)}` as const,
        integratedRevision: CANDIDATE,
        reason: null,
      })),
    };
  }
}

function request(): RoundWorkRequest {
  return {
    runId: "match-1",
    round: 2,
    scenarioId: "station-access",
    repositoryPath: "/scenario",
    baseRevision: BASE,
    participants: IDS.map((participantId, index) => ({
      participantId,
      assignmentId: `assignment-${index}`,
    })),
  };
}

describe("ContainedOmpThreeRoundRunner", () => {
  it("runs four isolated sessions against one round base and integrates in roster order", async () => {
    const workspaces = new FakeWorkspaces();
    const runtimes = new FakeRuntimes();
    const integrator = new FakeIntegrator();
    const context = new MatchObservationContext();
    const runner = new ContainedOmpThreeRoundRunner(
      workspaces,
      runtimes,
      {
        read: (runId, participantId) => ({
          schemaVersion: "1.0",
          runId,
          participantId,
          publicTask: "Task",
          safetyBrief: "Safety",
          assignment: { id: participantId, instructions: "Work" },
          role: "builder",
        }),
      },
      integrator,
      context,
      { maximumOutputTokens: 4_000, wallTimeMilliseconds: 60_000 },
    );

    const work = await runner.runWork(request());
    expect(work.participants).toHaveLength(4);
    expect(runtimes.observationRuns).toEqual(IDS.map(() => "match-1"));
    expect(context.current()).toEqual({ round: 2, phase: "work" });
    for (const runtime of runtimes.runtimes.values()) {
      expect(runtime.operations).toEqual([
        "start:match-1",
        `brief:match-1:${runtime.participantId}`,
        "run",
        "stop:round_completed",
      ]);
    }

    const integrated = await runner.integrate(work.roundId);
    expect(integrated.governance).toEqual({
      initialCredits: 18,
      creditsSpent: 0,
      activeParticipantIds: IDS,
      quarantinedParticipantIds: [],
    });
    expect(integrator.request?.proposalOrder).toEqual(
      IDS.map((id) => `proposal-r2-${id}`),
    );
    expect(context.current()).toEqual({ round: 2, phase: "integration" });
    expect(workspaces.cleaned).toEqual(["match-1-round-2"]);
  });
});
