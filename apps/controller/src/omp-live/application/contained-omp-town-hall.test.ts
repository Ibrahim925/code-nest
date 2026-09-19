import { describe, expect, it } from "vitest";

import type { MatchResolutionFact } from "../../matches/application/ports/three-round-match-ports.js";
import type { ParticipantWorkspace } from "../../workspaces/domain/workspace.js";
import {
  ContainedOmpTownHall,
  type TownHallRuntimeFactory,
} from "./contained-omp-town-hall.js";
import { MatchObservationContext } from "./match-observation-context.js";

const IDS = ["player-a", "player-b", "player-c", "player-d"] as const;
const REVISION = "a".repeat(40);

function workspace(participantId: string): ParticipantWorkspace {
  return {
    schemaVersion: "1.0",
    runId: "match-1-round-1",
    participantId,
    path: `/workspaces/${participantId}`,
    baseRevision: REVISION,
  };
}

class FakeTownHallRuntime {
  readonly contexts: {
    readonly pass: string;
    readonly transcriptLength: number;
  }[] = [];
  stopped = false;
  #pass = "";
  #turn = 0;

  constructor(
    readonly participantId: string,
    private readonly order: string[],
  ) {}

  async start() {
    return {
      sessionId: `discussion-${this.participantId}`,
      descriptor: {
        adapterName: "omp-rpc",
        adapterVersion: "1.0",
        runtimeName: "omp",
        runtimeVersion: "18.1.14",
        modelProvider: "code-nest-openai",
        modelName: "gpt-5.6-luna",
        executionMode: "contained" as const,
        observabilityTier: 2 as const,
        capabilities: [],
      },
    };
  }

  async deliverBrief() {}

  async deliverTownHallContext(input: {
    readonly pass: "evidence_accusation" | "defence_rebuttal";
    readonly transcript: readonly unknown[];
  }) {
    this.#pass = input.pass;
    this.contexts.push({
      pass: input.pass,
      transcriptLength: input.transcript.length,
    });
  }

  async run() {
    this.#turn += 1;
    this.order.push(`${this.#pass}:${this.participantId}`);
    const yielded = this.participantId === "player-b" && this.#turn === 1;
    return {
      status: "completed" as const,
      candidateRevision: REVISION,
      commitSummary: "Discussion only",
      publicMessages: yielded
        ? []
        : [`${this.participantId} responds during ${this.#pass}.`],
      usage: null,
    };
  }

  async stop() {
    this.stopped = true;
    return { sessionId: `discussion-${this.participantId}`, turnsCompleted: 2 };
  }
}

class FakeTownHallFactory implements TownHallRuntimeFactory {
  readonly runtimes = new Map<string, FakeTownHallRuntime>();
  readonly order: string[] = [];

  async createForDiscussion(value: ParticipantWorkspace) {
    const runtime = new FakeTownHallRuntime(value.participantId, this.order);
    this.runtimes.set(value.participantId, runtime);
    return runtime;
  }
}

describe("ContainedOmpTownHall", () => {
  it("runs two live speaking passes with every prior public turn in context", async () => {
    const factory = new FakeTownHallFactory();
    const context = new MatchObservationContext();
    const townHall = new ContainedOmpTownHall(
      factory,
      {
        read: (runId, participantId) => ({
          schemaVersion: "1.0",
          runId,
          participantId,
          publicTask: "Task",
          safetyBrief: "Safety",
          assignment: { id: participantId, instructions: "Review the work." },
          role: "builder",
        }),
      },
      context,
      { maximumOutputTokens: 2_000, wallTimeMilliseconds: 60_000 },
    );
    const facts: MatchResolutionFact[] = [];
    await townHall.run({
      request: {
        runId: "match-1",
        round: 1,
        scenarioId: "station-access",
        repositoryPath: "/scenario",
        baseRevision: REVISION,
        participants: IDS.map((participantId) => ({
          participantId,
          assignmentId: participantId,
        })),
      },
      workspaces: IDS.map(workspace),
      recorder: { record: async (fact) => { facts.push(fact); } },
    });

    expect(factory.order).toEqual([
      ...IDS.map((id) => `evidence_accusation:${id}`),
      ...IDS.map((id) => `defence_rebuttal:${id}`),
    ]);
    expect(facts.map(({ type }) => type)).toEqual([
      "town_hall_started",
      ...Array.from({ length: 8 }, () => "town_hall_turn_recorded"),
    ]);
    const turns = facts.flatMap((fact) =>
      fact.type === "town_hall_turn_recorded" ? [fact.turn] : []
    );
    expect(turns[1]?.message).toBeNull();
    expect(factory.runtimes.get("player-a")?.contexts).toEqual([
      { pass: "evidence_accusation", transcriptLength: 0 },
      { pass: "defence_rebuttal", transcriptLength: 4 },
    ]);
    expect([...factory.runtimes.values()].every(({ stopped }) => stopped)).toBe(true);
    expect(context.current()).toEqual({ round: 1, phase: "town_hall" });
  });
});
