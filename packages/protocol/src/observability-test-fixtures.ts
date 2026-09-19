import { EVENT_SCHEMA_VERSION } from "./envelope-schemas.js";
import { OBSERVABILITY_PAYLOAD_VERSION } from "./observability-schemas.js";

export const frameDigest = `sha256:${"a".repeat(64)}`;
export const memoryDigest = `sha256:${"b".repeat(64)}`;

export function participantPrivate(participantId = "player-a") {
  return { class: "participant_private", recipientIds: [participantId] } as const;
}

export function baseEvent(
  overrides: Record<string, unknown>,
): Record<string, unknown> {
  return {
    schemaVersion: EVENT_SCHEMA_VERSION,
    eventId: "evt-001",
    runId: "run-001",
    sequence: 1,
    recordedAt: "2026-09-18T12:00:00.000Z",
    actor: { kind: "participant", id: "player-a" },
    context: { round: 1, phase: "work" },
    kind: "runtime.activity_reported",
    payload: {},
    visibility: participantPrivate(),
    causationId: null,
    correlationId: "corr-001",
    parentEventIds: [],
    artifactDigests: [],
    resourceCost: {},
    ...overrides,
  };
}

export function activityEvent(): Record<string, unknown> {
  return baseEvent({
    kind: "runtime.activity_reported",
    payload: {
      schemaVersion: OBSERVABILITY_PAYLOAD_VERSION,
      participantId: "player-a",
      state: "working",
      summary: "Inspecting the repository boundary.",
      provenance: "agent_submitted",
    },
  });
}

export function rationaleEvent(): Record<string, unknown> {
  return baseEvent({
    kind: "runtime.rationale_submitted",
    payload: {
      schemaVersion: OBSERVABILITY_PAYLOAD_VERSION,
      participantId: "player-a",
      body: "I chose the smallest change that preserves the contract.",
      provenance: "agent_submitted",
      provider: null,
      model: null,
    },
  });
}

export function toolEvent(): Record<string, unknown> {
  return baseEvent({
    actor: { kind: "runtime", id: "runtime-a" },
    kind: "runtime.tool_observed",
    payload: {
      schemaVersion: OBSERVABILITY_PAYLOAD_VERSION,
      participantId: "player-a",
      toolCallId: "tool-001",
      toolName: "shell",
      status: "started",
      summary: "Running the repository test suite.",
    },
  });
}

export function frameEvent(): Record<string, unknown> {
  return baseEvent({
    actor: { kind: "runtime", id: "runtime-a" },
    kind: "runtime.computer_frame_captured",
    payload: {
      schemaVersion: OBSERVABILITY_PAYLOAD_VERSION,
      participantId: "player-a",
      frameId: "frame-001",
      captureReason: "action",
      frameSequence: 1,
      mediaType: "image/png",
      width: 1_280,
      height: 720,
      byteCount: 12_000,
      digest: frameDigest,
      redactionStatus: "clear",
      withheldReason: null,
    },
    artifactDigests: [frameDigest],
  });
}

export function memoryEvent(): Record<string, unknown> {
  return baseEvent({
    kind: "memory.updated",
    payload: {
      schemaVersion: OBSERVABILITY_PAYLOAD_VERSION,
      participantId: "player-a",
      memoryId: "working-memory",
      revision: 2,
      reason: "agent_consolidation",
      summary: "Recorded the current hypothesis and next check.",
      byteCount: 512,
      digest: memoryDigest,
      previousDigest: `sha256:${"c".repeat(64)}`,
    },
    artifactDigests: [memoryDigest],
  });
}

export function messageEvent(): Record<string, unknown> {
  return baseEvent({
    kind: "message.published",
    payload: {
      messageId: "message-001",
      participantId: "player-a",
      channel: "general",
      body: "The focused tests now pass.",
    },
    visibility: { class: "public" },
  });
}

export function phaseEvent(): Record<string, unknown> {
  return baseEvent({
    actor: { kind: "controller", id: "controller" },
    context: { round: 1, phase: "town_hall" },
    kind: "match.phase_advanced",
    payload: {
      from: { round: 1, phase: "belief" },
      to: { round: 1, phase: "town_hall" },
    },
    visibility: { class: "public" },
  });
}

export function townHallStartedEvent(): Record<string, unknown> {
  return baseEvent({
    actor: { kind: "controller", id: "controller" },
    context: { round: 1, phase: "town_hall" },
    kind: "town_hall.started",
    payload: {
      round: 1,
      speakingOrder: ["player-a", "player-b", "player-c", "player-d"],
    },
    visibility: { class: "public" },
  });
}

export function townHallTurnEvent(): Record<string, unknown> {
  return baseEvent({
    context: { round: 1, phase: "town_hall" },
    kind: "town_hall.turn_recorded",
    payload: {
      turn: {
        turnId: "turn-001",
        participantId: "player-a",
        pass: "evidence_accusation",
        message: "The cited event conflicts with the claimed file state.",
        citations: [
          {
            eventId: "evt-prior",
            claimedKind: "runtime.file_changed",
            status: "valid",
          },
        ],
      },
    },
    visibility: { class: "public" },
  });
}

export const validObservabilityEvents = [
  activityEvent(),
  rationaleEvent(),
  toolEvent(),
  frameEvent(),
  memoryEvent(),
  messageEvent(),
  phaseEvent(),
  townHallStartedEvent(),
  townHallTurnEvent(),
];
