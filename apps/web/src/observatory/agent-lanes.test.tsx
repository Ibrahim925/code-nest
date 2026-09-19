import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { DecodedEventDelivery } from "../events/domain/live-events.js";
import { DEFAULT_RUN_SETUP } from "../run-setup/catalog.js";
import { AgentLanes } from "./AgentLanes.js";
import { LiveObservatory } from "./LiveObservatory.js";
import {
  createAgentLaneState,
  projectAgentLanes,
} from "./application/project-agent-lanes.js";

const participants = ["a", "b", "c", "d"].map((suffix) => ({
  participantId: `player-${suffix}`,
  adapterId: "fake-scripted",
  executionMode: "split" as const,
  modelDisclosure: "Deterministic fixture",
}));

function delivery(
  sequence: number,
  kind: string,
  payload: unknown,
  context: { round: number | null; phase: string | null } = {
    round: 1,
    phase: "work",
  },
): DecodedEventDelivery {
  const eventId = `event-${sequence}`;
  return {
    deliverySequence: sequence,
    eventId,
    kind,
    event: { eventId, kind, payload, context },
  };
}

function runtimeDescriptor() {
  return {
    adapterName: "fake",
    runtimeName: "scripted participant",
    modelName: "deterministic fixture",
    executionMode: "split",
    observabilityTier: 1,
    capabilities: ["typed_tool_events", "usage_accounting"],
  };
}

describe("four concurrent agent lanes", () => {
  it("creates exactly four stable lanes without inventing health or assignment", () => {
    const state = createAgentLaneState(participants);
    expect(state.lanes.map(({ participantId }) => participantId)).toEqual([
      "player-a",
      "player-b",
      "player-c",
      "player-d",
    ]);
    expect(state.lanes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          assignmentId: null,
          activity: "starting",
          containerHealth: { availability: "unavailable", label: "Not reported" },
          runtime: null,
        }),
      ]),
    );
    expect(() => createAgentLaneState(participants.slice(0, 3))).toThrow(
      "exactly four",
    );
  });

  it("projects assignments, phase, runtime capability, and work into the owning lane", () => {
    let state = createAgentLaneState(participants);
    state = projectAgentLanes(state, delivery(1, "briefing.completed", {
      assignments: participants.map(({ participantId }, index) => ({
        participantId,
        assignmentId: ["policy", "delegation", "emergency", "audit"][index],
      })),
    }, { round: 1, phase: "briefing" }));
    state = projectAgentLanes(state, delivery(2, "runtime.started", {
      participantId: "player-c",
      descriptor: runtimeDescriptor(),
    }));
    state = projectAgentLanes(state, delivery(3, "participant.work_captured", {
      participantId: "player-c",
      turn: { candidateRevision: "abc123" },
    }));
    state = projectAgentLanes(state, delivery(4, "container.health_changed", {
      participantId: "player-c",
      status: "healthy",
    }));

    expect(state.lanes.map(({ participantId }) => participantId)).toEqual(
      participants.map(({ participantId }) => participantId),
    );
    expect(state.lanes[2]).toMatchObject({
      assignmentId: "emergency",
      phase: { round: 1, name: "work" },
      activity: "awaiting Town Hall",
      activityEventId: "event-3",
      latestCommit: "abc123",
      runtime: {
        runtimeName: "scripted participant",
        observabilityTier: 1,
        capabilities: ["typed_tool_events", "usage_accounting"],
      },
      containerHealth: { availability: "available", status: "healthy", label: "healthy" },
    });
    expect(state.lanes[0]?.activity).toBe("starting");
  });

  it("restores factual activity after pause and preserves quarantine until completion", () => {
    let state = createAgentLaneState(participants);
    state = projectAgentLanes(state, delivery(1, "runtime.started", {
      participantId: "player-a",
      descriptor: runtimeDescriptor(),
    }));
    state = projectAgentLanes(state, delivery(2, "run.paused", {}));
    expect(state.lanes.every(({ activity }) => activity === "paused")).toBe(true);
    state = projectAgentLanes(state, delivery(3, "run.resumed", {}));
    expect(state.lanes[0]?.activity).toBe("working");
    expect(state.lanes[1]?.activity).toBe("starting");
    state = projectAgentLanes(state, delivery(4, "match.round_integrated", {
      governance: { quarantinedParticipantIds: ["player-b"] },
    }, { round: 1, phase: "integration" }));
    state = projectAgentLanes(state, delivery(5, "runtime.started", {
      participantId: "player-b",
      descriptor: runtimeDescriptor(),
    }));
    expect(state.lanes[1]?.activity).toBe("quarantined");
    state = projectAgentLanes(state, delivery(6, "match.completed", {}, {
      round: 3,
      phase: "completion",
    }));
    expect(state.lanes.every(({ activity }) => activity === "finished")).toBe(true);
  });

  it("ignores duplicate or malformed updates instead of corrupting projection", () => {
    const initial = createAgentLaneState(participants);
    const projected = projectAgentLanes(initial, delivery(1, "runtime.started", {
      participantId: "unknown-player",
      descriptor: runtimeDescriptor(),
    }));
    expect(projected.lanes).toEqual(initial.lanes.map((lane) => ({
      ...lane,
      phase: { round: 1, name: "work" },
    })));
    expect(projectAgentLanes(projected, delivery(1, "run.paused", {}))).toBe(
      projected,
    );
  });

  it("renders non-color status, explicit unavailable facts, and activity provenance", () => {
    const state = projectAgentLanes(
      createAgentLaneState(participants),
      delivery(1, "runtime.started", {
        participantId: "player-a",
        descriptor: runtimeDescriptor(),
      }),
    );
    const markup = renderToStaticMarkup(<AgentLanes state={state} />);
    expect(markup.match(/class="agent-lane"/g)).toHaveLength(4);
    expect(markup).toContain("Participant runtime lanes");
    expect(markup).toContain("Current observable activity");
    expect(markup).toContain("working");
    expect(markup.match(/Not reported/g)).toHaveLength(4);
    expect(markup).toContain("Caused by event-1");
    expect(markup).not.toContain("healthy");
  });

  it("composes the run bar, connection state, controls, and lane rail", () => {
    const markup = renderToStaticMarkup(
      <LiveObservatory
        baseUrl="/api"
        bearerToken="not-rendered"
        configuration={DEFAULT_RUN_SETUP}
        run={{
          schemaVersion: "1.0",
          runId: "run-029",
          status: "running",
          terminalReason: null,
          createdAt: "2026-09-18T12:00:00.000Z",
          updatedAt: "2026-09-18T12:00:00.000Z",
          lastEventSequence: 1,
        }}
        pendingAction={null}
        controlError={null}
        onMutation={() => undefined}
      />,
    );
    expect(markup).toContain("Live Observatory");
    expect(markup).toContain("run-029");
    expect(markup).toContain("Connecting");
    expect(markup.match(/class="agent-computer agent-lane"/g)).toHaveLength(4);
    expect(markup).toContain("Pause");
    expect(markup).not.toContain("not-rendered");
  });
});
