import { describe, expect, it } from "vitest";

import type { DecodedEventDelivery } from "../../events/domain/live-events.js";
import { createAgentObservatoryState, projectAgentObservatory } from "./project-agent-observatory.js";

const digestA = `sha256:${"a".repeat(64)}`;
const digestB = `sha256:${"b".repeat(64)}`;
const participants = ["a", "b", "c", "d"].map((id) => ({
  participantId: `player-${id}`,
  adapterId: "omp-rpc",
  executionMode: "contained" as const,
  modelDisclosure: "OpenAI · GPT-5.6 Luna",
}));

function delivery(
  sequence: number,
  kind: string,
  payload: unknown,
  overrides: Record<string, unknown> = {},
): DecodedEventDelivery {
  const eventId = `event-${sequence}`;
  return {
    deliverySequence: sequence,
    eventId,
    kind,
    event: {
      schemaVersion: "1.0",
      eventId,
      runId: "run-001",
      recordedAt: `2026-09-18T12:00:${String(sequence % 60).padStart(2, "0")}.000Z`,
      actor: { kind: "runtime", id: "omp-a" },
      context: { round: 1, phase: "work" },
      kind,
      payload,
      visibility: {
        class: "participant_private",
        recipientIds: ["player-a"],
      },
      causationId: null,
      correlationId: "run-001",
      parentEventIds: [],
      artifactDigests: [],
      resourceCost: {},
      ...overrides,
    },
  };
}

function activity(
  sequence: number,
  state: string,
): DecodedEventDelivery {
  return delivery(sequence, "runtime.activity_reported", {
    schemaVersion: "1.0",
    participantId: "player-a",
    state,
    summary: `Activity ${state}`,
    provenance: "runtime_observed",
  });
}

function frame(
  sequence: number,
  redactionStatus: "clear" | "redacted" = "clear",
): DecodedEventDelivery {
  return delivery(
    sequence,
    "runtime.computer_frame_captured",
    {
      schemaVersion: "1.0",
      participantId: "player-a",
      frameId: `frame-${sequence}`,
      captureReason: "action",
      frameSequence: sequence,
      mediaType: "image/png",
      width: 1_280,
      height: 720,
      byteCount: 4_096,
      digest: digestA,
      redactionStatus,
      withheldReason: null,
    },
    { artifactDigests: [digestA] },
  );
}

describe("four-agent Observatory projector", () => {
  it("starts four fixed model lanes with honest empty states", () => {
    const state = createAgentObservatoryState(participants);
    expect(state.agents.map((agent) => agent.participantId)).toEqual([
      "player-a",
      "player-b",
      "player-c",
      "player-d",
    ]);
    expect(state.agents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          activity: expect.objectContaining({
            availability: "awaiting",
            summary: "Awaiting first activity report",
          }),
          computer: expect.objectContaining({
            status: "awaiting",
            label: "Awaiting first computer frame",
          }),
          rationale: null,
          memory: null,
        }),
      ]),
    );
    expect(() => createAgentObservatoryState(participants.slice(0, 3))).toThrow();
  });

  it("projects phase, private work, memory, and public discourse in order", () => {
    const deliveries = [
      delivery(
        1,
        "match.phase_advanced",
        {
          from: { round: 1, phase: "belief" },
          to: { round: 1, phase: "town_hall" },
        },
        {
          actor: { kind: "controller", id: "controller" },
          context: { round: 1, phase: "town_hall" },
          visibility: { class: "public" },
        },
      ),
      activity(2, "working"),
      delivery(
        3,
        "runtime.rationale_submitted",
        {
          schemaVersion: "1.0",
          participantId: "player-a",
          body: "I am checking the smallest relevant policy boundary.",
          provenance: "agent_submitted",
          provider: null,
          model: null,
        },
        { actor: { kind: "participant", id: "player-a" } },
      ),
      delivery(4, "runtime.tool_observed", {
        schemaVersion: "1.0",
        participantId: "player-a",
        toolCallId: "tool-001",
        toolName: "shell",
        status: "completed",
        summary: "Focused tests passed.",
      }),
      frame(5, "redacted"),
      delivery(
        6,
        "memory.updated",
        {
          schemaVersion: "1.0",
          participantId: "player-a",
          memoryId: "working-memory",
          revision: 1,
          reason: "agent_consolidation",
          summary: "Saved the next check.",
          byteCount: 128,
          digest: digestB,
          previousDigest: null,
        },
        {
          actor: { kind: "participant", id: "player-a" },
          artifactDigests: [digestB],
        },
      ),
      delivery(
        7,
        "message.published",
        {
          messageId: "message-001",
          participantId: "player-a",
          channel: "general",
          body: "The policy checks pass.",
        },
        {
          actor: { kind: "participant", id: "player-a" },
          visibility: { class: "public" },
        },
      ),
      delivery(
        8,
        "town_hall.turn_recorded",
        {
          turn: {
            turnId: "turn-001",
            participantId: "player-a",
            pass: "evidence_accusation",
            message: null,
            citations: [],
          },
        },
        {
          actor: { kind: "participant", id: "player-a" },
          context: { round: 1, phase: "town_hall" },
          visibility: { class: "public" },
        },
      ),
    ];
    const state = deliveries.reduce(
      projectAgentObservatory,
      createAgentObservatoryState(participants),
    );
    expect(state.phase).toMatchObject({
      round: 1,
      name: "town_hall",
      transitionCount: 1,
    });
    expect(state.agents[0]).toMatchObject({
      activity: { availability: "reported", state: "working" },
      rationale: {
        provenance: "agent_submitted",
        attribution: "Submitted by agent",
      },
      latestTool: { toolName: "shell", status: "completed" },
      computer: { status: "redacted", freshness: "current" },
      memory: { revision: 1, digest: digestB },
    });
    expect(state.discourse).toEqual([
      expect.objectContaining({ channel: "general", yielded: false }),
      expect.objectContaining({ channel: "town_hall", yielded: true }),
    ]);
    expect(state.timeline).toHaveLength(8);
  });

  it("makes redaction, staleness, withholding, and disconnects explicit", () => {
    let state = createAgentObservatoryState(participants);
    state = projectAgentObservatory(state, frame(1));
    expect(state.agents[0]?.computer).toMatchObject({
      status: "visible",
      freshness: "current",
    });
    state = projectAgentObservatory(
      state,
      delivery(2, "runtime.tool_observed", {
        schemaVersion: "1.0",
        participantId: "player-a",
        toolCallId: "tool-002",
        toolName: "read",
        status: "started",
        summary: null,
      }),
    );
    expect(state.agents[0]?.computer.freshness).toBe("stale");
    state = projectAgentObservatory(
      state,
      delivery(3, "runtime.computer_frame_captured", {
        schemaVersion: "1.0",
        participantId: "player-a",
        frameId: "frame-3",
        captureReason: "heartbeat",
        frameSequence: 3,
        mediaType: null,
        width: null,
        height: null,
        byteCount: 0,
        digest: null,
        redactionStatus: "withheld",
        withheldReason: "suspected_secret",
      }),
    );
    expect(state.agents[0]?.computer).toMatchObject({
      status: "withheld",
      freshness: "current",
      withheldReason: "suspected_secret",
      lastVisibleFrame: { digest: digestA },
    });
    state = projectAgentObservatory(state, activity(4, "failed"));
    expect(state.agents[0]?.computer).toMatchObject({
      status: "disconnected",
      freshness: "stale",
      label: "Computer disconnected",
    });
  });

  it("ignores malformed, unknown-participant, duplicate, and older deliveries", () => {
    const initial = createAgentObservatoryState(participants);
    const malformed = delivery(2, "runtime.activity_reported", {
      participantId: "player-a",
      thinking: "not a valid contract",
    });
    const afterMalformed = projectAgentObservatory(initial, malformed);
    expect(afterMalformed.lastDeliverySequence).toBe(2);
    expect(afterMalformed.timeline).toEqual([]);
    expect(projectAgentObservatory(afterMalformed, activity(1, "working"))).toBe(
      afterMalformed,
    );
    const unknown = delivery(3, "runtime.activity_reported", {
      schemaVersion: "1.0",
      participantId: "player-z",
      state: "working",
      summary: "Unknown participant.",
      provenance: "runtime_observed",
    }, {
      visibility: {
        class: "participant_private",
        recipientIds: ["player-z"],
      },
    });
    const final = projectAgentObservatory(afterMalformed, unknown);
    expect(final.agents).toBe(afterMalformed.agents);
    expect(final.timeline).toHaveLength(1);
  });

  it("deterministically retains 10,000 ordered Observatory facts", () => {
    let state = createAgentObservatoryState(participants);
    const startedAt = performance.now();
    for (let sequence = 1; sequence <= 10_000; sequence += 1) {
      state = projectAgentObservatory(state, activity(sequence, "working"));
    }
    const elapsed = performance.now() - startedAt;

    expect(state.lastDeliverySequence).toBe(10_000);
    expect(state.timeline).toHaveLength(10_000);
    expect(state.timeline[0]).toMatchObject({ deliverySequence: 1 });
    expect(state.timeline.at(-1)).toMatchObject({ deliverySequence: 10_000 });
    expect(state.agents[0]?.activity).toMatchObject({
      state: "working",
      deliverySequence: 10_000,
    });
    expect(elapsed).toBeLessThan(2_000);
  });
});
