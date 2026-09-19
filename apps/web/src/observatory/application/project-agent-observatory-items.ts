import type { ObservabilityEvent } from "@code-nest/protocol";

import type {
  ObservatoryDiscourseItem,
  ObservatoryTimelineItem,
} from "../domain/agent-observatory.js";
import { sanitizeUntrustedText } from "./sanitize-untrusted-text.js";

export function observatoryDiscourseItem(
  event: ObservabilityEvent,
  deliverySequence: number,
): ObservatoryDiscourseItem | null {
  if (event.kind === "message.published") {
    const body = sanitizeUntrustedText(event.payload.body, 4_000);
    if (body === null) return null;
    return {
      id: event.payload.messageId,
      eventId: event.eventId,
      participantId: event.payload.participantId,
      channel: event.payload.channel,
      body: body.text,
      yielded: false,
      deliverySequence,
    };
  }
  if (event.kind !== "town_hall.turn_recorded") return null;
  const body = sanitizeUntrustedText(event.payload.turn.message, 4_000);
  return {
    id: event.payload.turn.turnId,
    eventId: event.eventId,
    participantId: event.payload.turn.participantId,
    channel: "town_hall",
    body: body?.text ?? null,
    yielded: event.payload.turn.message === null,
    deliverySequence,
  };
}

export function observatoryTimelineItem(
  event: ObservabilityEvent,
  deliverySequence: number,
): ObservatoryTimelineItem {
  const participantId =
    event.kind === "match.phase_advanced" || event.kind === "town_hall.started"
      ? null
      : event.kind === "town_hall.turn_recorded"
        ? event.payload.turn.participantId
        : event.payload.participantId;
  const labels: Partial<Record<ObservabilityEvent["kind"], string>> = {
    "match.phase_advanced": "Phase changed",
    "runtime.activity_reported": "Activity reported",
    "runtime.rationale_submitted": "Rationale submitted",
    "runtime.tool_observed": "Tool observed",
    "runtime.computer_frame_captured": "Computer frame captured",
    "memory.updated": "Working memory updated",
    "message.published": "Message published",
    "town_hall.started": "Town Hall started",
    "town_hall.turn_recorded": "Town Hall turn recorded",
  };
  return {
    eventId: event.eventId,
    deliverySequence,
    participantId,
    kind: event.kind,
    label: labels[event.kind] ?? event.kind,
  };
}
