import { parseEventDelivery } from "@code-nest/protocol";

import { LiveEventClientError } from "../application/live-event-client.js";
import type { EventDeliveryDecoder } from "../application/ports/event-stream.js";
import type { DecodedEventDelivery, SseEventFrame } from "../domain/live-events.js";

export class ProtocolEventDeliveryDecoder implements EventDeliveryDecoder {
  decode(frame: SseEventFrame): DecodedEventDelivery {
    if (frame.event !== "code-nest-event") {
      throw new LiveEventClientError(
        "INVALID_EVENT_TYPE",
        "The controller sent an unexpected live event type.",
      );
    }

    let input: unknown;
    try {
      input = JSON.parse(frame.data);
    } catch {
      throw new LiveEventClientError(
        "INVALID_EVENT_JSON",
        "The controller sent malformed live event data.",
      );
    }

    const parsed = parseEventDelivery(input);
    if (!parsed.ok) {
      throw new LiveEventClientError(
        parsed.error.code,
        "The controller sent an invalid live event delivery.",
      );
    }
    if (parsed.value.event.eventId !== frame.id) {
      throw new LiveEventClientError(
        "EVENT_ID_MISMATCH",
        "The live event frame and delivery identifiers do not match.",
      );
    }

    return {
      deliverySequence: parsed.value.deliverySequence,
      eventId: parsed.value.event.eventId,
      kind: parsed.value.event.kind,
      event: parsed.value.event,
    };
  }
}
