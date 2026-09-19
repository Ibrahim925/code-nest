import type { ValidationIssue } from "./envelope-validation.js";
import type {
  ObservabilityEvent,
  ObservabilityEventKind,
} from "./observability-schemas.js";

const PRIVATE_KINDS = new Set<ObservabilityEventKind>([
  "runtime.activity_reported",
  "runtime.rationale_submitted",
  "runtime.tool_observed",
  "runtime.computer_frame_captured",
  "memory.updated",
]);

function issue(
  code: string,
  message: string,
  path: string,
): ValidationIssue {
  return { code, message, path };
}

function participantId(event: ObservabilityEvent): string | undefined {
  switch (event.kind) {
    case "match.phase_advanced":
    case "town_hall.started":
      return undefined;
    case "town_hall.turn_recorded":
      return event.payload.turn.participantId;
    default:
      return event.payload.participantId;
  }
}

function visibilityIssues(event: ObservabilityEvent): ValidationIssue[] {
  const ownerId = participantId(event);
  if (PRIVATE_KINDS.has(event.kind)) {
    if (
      event.visibility.class === "participant_private" &&
      event.visibility.recipientIds.length === 1 &&
      event.visibility.recipientIds[0] === ownerId
    ) {
      return [];
    }
    return [
      issue(
        "observability_visibility",
        "Private observability events must target only their owning participant.",
        "/visibility",
      ),
    ];
  }
  if (event.visibility.class === "public") return [];
  return [
    issue(
      "observability_visibility",
      "Discourse and phase observability events must be public.",
      "/visibility",
    ),
  ];
}

function expectedActorKind(event: ObservabilityEvent): "participant" | "runtime" | "controller" {
  switch (event.kind) {
    case "match.phase_advanced":
    case "town_hall.started":
      return "controller";
    case "runtime.tool_observed":
    case "runtime.computer_frame_captured":
      return "runtime";
    case "runtime.activity_reported":
      return event.payload.provenance === "agent_submitted"
        ? "participant"
        : "runtime";
    case "runtime.rationale_submitted":
      return event.payload.provenance === "agent_submitted"
        ? "participant"
        : "runtime";
    default:
      return "participant";
  }
}

function actorIssues(event: ObservabilityEvent): ValidationIssue[] {
  const expectedKind = expectedActorKind(event);
  if (event.actor.kind !== expectedKind) {
    return [
      issue(
        "observability_actor",
        `This event must be recorded by a ${expectedKind} actor.`,
        "/actor/kind",
      ),
    ];
  }
  const ownerId = participantId(event);
  if (expectedKind !== "participant" || event.actor.id === ownerId) return [];
  return [
    issue(
      "observability_actor",
      "Participant-authored events must identify the same participant in actor and payload.",
      "/actor/id",
    ),
  ];
}

function digestIssues(event: ObservabilityEvent): ValidationIssue[] {
  let expected: readonly string[] = [];
  if (event.kind === "memory.updated") expected = [event.payload.digest];
  if (
    event.kind === "runtime.computer_frame_captured" &&
    event.payload.digest !== null
  ) {
    expected = [event.payload.digest];
  }
  if (
    event.artifactDigests.length === expected.length &&
    event.artifactDigests.every((digest, index) => digest === expected[index])
  ) {
    return [];
  }
  return [
    issue(
      "artifact_binding",
      "Artifact digests must exactly match the artifacts declared by the payload.",
      "/artifactDigests",
    ),
  ];
}

function contextIssues(event: ObservabilityEvent): ValidationIssue[] {
  if (event.kind === "match.phase_advanced") {
    if (
      event.context.round === event.payload.to.round &&
      event.context.phase === event.payload.to.phase
    ) {
      return [];
    }
    return [
      issue(
        "context_mismatch",
        "Phase transition context must identify the destination position.",
        "/context",
      ),
    ];
  }
  if (event.kind === "town_hall.started") {
    if (
      event.context.round === event.payload.round &&
      event.context.phase === "town_hall"
    ) {
      return [];
    }
    return [
      issue(
        "context_mismatch",
        "Town hall context must identify its round and town_hall phase.",
        "/context",
      ),
    ];
  }
  if (
    event.kind === "town_hall.turn_recorded" &&
    event.context.phase !== "town_hall"
  ) {
    return [
      issue(
        "context_mismatch",
        "Town hall turns must be recorded in the town_hall phase.",
        "/context/phase",
      ),
    ];
  }
  return [];
}

export function observabilityPolicyIssues(
  event: ObservabilityEvent,
): ValidationIssue[] {
  return [
    ...visibilityIssues(event),
    ...actorIssues(event),
    ...digestIssues(event),
    ...contextIssues(event),
  ];
}
