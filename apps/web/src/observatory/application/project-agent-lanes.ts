import type { DecodedEventDelivery } from "../../events/domain/live-events.js";
import type {
  AgentActivity,
  AgentLane,
  AgentLaneSeed,
  AgentLaneState,
  AgentRuntimeProfile,
} from "../domain/agent-lane.js";

type UnknownRecord = Readonly<Record<string, unknown>>;

function record(value: unknown): UnknownRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 160
    ? value
    : null;
}

function phase(value: unknown): AgentLane["phase"] | null {
  const context = record(value);
  if (context === null) return null;
  const round = context.round;
  const name = context.phase;
  if (round !== null && (!Number.isSafeInteger(round) || Number(round) < 1)) return null;
  if (name !== null && typeof name !== "string") return null;
  return { round: round as number | null, name };
}

function participantId(payload: UnknownRecord): string | null {
  return text(payload.participantId);
}

function activity(
  lane: AgentLane,
  next: AgentActivity,
  eventId: string,
): AgentLane {
  if (lane.activity === "quarantined" && next !== "finished") return lane;
  return {
    ...lane,
    activity: next,
    activityEventId: eventId,
    activityBeforePause: null,
  };
}

function runtimeProfile(value: unknown): AgentRuntimeProfile | null {
  const input = record(value);
  if (input === null) return null;
  const adapterName = text(input.adapterName);
  const runtimeName = text(input.runtimeName);
  const modelName = text(input.modelName);
  const executionMode = input.executionMode;
  const observabilityTier = input.observabilityTier;
  const capabilities = input.capabilities;
  if (
    adapterName === null ||
    runtimeName === null ||
    modelName === null ||
    (executionMode !== "contained" && executionMode !== "split") ||
    (observabilityTier !== 0 && observabilityTier !== 1 && observabilityTier !== 2) ||
    !Array.isArray(capabilities) ||
    capabilities.some((item) => typeof item !== "string")
  ) return null;
  return {
    adapterName,
    runtimeName,
    modelName,
    executionMode,
    observabilityTier,
    capabilities: [...capabilities] as string[],
  };
}

export function createAgentLaneState(
  participants: readonly AgentLaneSeed[],
): AgentLaneState {
  if (participants.length !== 4) {
    throw new Error("The Live Observatory requires exactly four participant lanes.");
  }
  if (new Set(participants.map(({ participantId: id }) => id)).size !== 4) {
    throw new Error("Live Observatory participant identities must be unique.");
  }
  return {
    lastDeliverySequence: 0,
    lanes: participants.map((participant, index) => ({
      ...participant,
      slot: index + 1,
      assignmentId: null,
      phase: { round: null, name: null },
      activity: "starting",
      activityEventId: null,
      activityBeforePause: null,
      runtime: null,
      containerHealth: { availability: "unavailable", label: "Not reported" },
      latestCommit: null,
    })),
  };
}

function updateParticipant(
  lanes: readonly AgentLane[],
  id: string | null,
  update: (lane: AgentLane) => AgentLane,
): readonly AgentLane[] {
  if (id === null || !lanes.some(({ participantId: value }) => value === id)) {
    return lanes;
  }
  return lanes.map((lane) => lane.participantId === id ? update(lane) : lane);
}

function applyAssignments(
  lanes: readonly AgentLane[],
  value: unknown,
): readonly AgentLane[] {
  if (!Array.isArray(value)) return lanes;
  let result = lanes;
  for (const item of value) {
    const assignment = record(item);
    if (assignment === null) continue;
    const id = text(assignment.participantId);
    const assignmentId = text(assignment.assignmentId);
    if (assignmentId !== null) {
      result = updateParticipant(result, id, (lane) => ({ ...lane, assignmentId }));
    }
  }
  return result;
}

function applyEvent(
  lanes: readonly AgentLane[],
  delivery: DecodedEventDelivery,
): readonly AgentLane[] {
  const event = record(delivery.event);
  const payload = record(event?.payload);
  if (event === null || payload === null) return lanes;
  const kind = text(event.kind);
  const eventId = text(event.eventId) ?? delivery.eventId;
  const nextPhase = phase(event.context);
  const result = nextPhase === null
    ? lanes
    : lanes.map((lane) => ({ ...lane, phase: nextPhase }));

  if (kind === "briefing.completed") {
    return applyAssignments(result, payload.assignments);
  }
  if (kind === "runtime.started") {
    const profile = runtimeProfile(payload.descriptor);
    return updateParticipant(result, participantId(payload), (lane) => ({
      ...activity(lane, "working", eventId),
      ...(profile === null ? {} : { runtime: profile }),
    }));
  }
  if (kind === "runtime.stopped") {
    return updateParticipant(result, participantId(payload), (lane) =>
      activity(lane, "finished", eventId));
  }
  if (kind === "container.health_changed") {
    const status = payload.status;
    const allowed = ["preparing", "healthy", "degraded", "stopped", "failed"];
    if (typeof status !== "string" || !allowed.includes(status)) return result;
    return updateParticipant(result, participantId(payload), (lane) => ({
      ...lane,
      containerHealth: {
        availability: "available",
        status: status as "preparing" | "healthy" | "degraded" | "stopped" | "failed",
        label: status.replaceAll("_", " "),
      },
    }));
  }
  if (kind === "participant.work_captured") {
    const turn = record(payload.turn);
    return updateParticipant(result, participantId(payload), (lane) => ({
      ...activity(lane, "awaiting Town Hall", eventId),
      latestCommit: text(turn?.candidateRevision) ?? lane.latestCommit,
    }));
  }
  if (kind === "run.paused") {
    return result.map((lane) => ({
      ...lane,
      activityBeforePause: lane.activity,
      activity: "paused",
      activityEventId: eventId,
    }));
  }
  if (kind === "run.resumed") {
    return result.map((lane) => lane.activity === "paused" ? {
      ...lane,
      activity: lane.activityBeforePause ?? "starting",
      activityBeforePause: null,
      activityEventId: eventId,
    } : lane);
  }
  if (kind === "match.round_integrated") {
    const governance = record(payload.governance);
    const quarantined = governance?.quarantinedParticipantIds;
    if (!Array.isArray(quarantined)) return result;
    const ids = new Set(quarantined.filter((id): id is string => typeof id === "string"));
    return result.map((lane) => ids.has(lane.participantId)
      ? activity(lane, "quarantined", eventId)
      : lane);
  }
  if (kind === "match.completed" || kind === "run.cancelled") {
    return result.map((lane) => activity(lane, "finished", eventId));
  }
  return result;
}

export function projectAgentLanes(
  state: AgentLaneState,
  delivery: DecodedEventDelivery,
): AgentLaneState {
  if (delivery.deliverySequence <= state.lastDeliverySequence) return state;
  return {
    lanes: applyEvent(state.lanes, delivery),
    lastDeliverySequence: delivery.deliverySequence,
  };
}
