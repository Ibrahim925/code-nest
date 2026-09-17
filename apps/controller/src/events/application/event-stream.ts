import {
  projectEventForAudience,
  type EventProjectionContext,
} from "@code-nest/core";
import {
  EVENT_DELIVERY_VERSION,
  type EventDelivery,
  type EventEnvelope,
} from "@code-nest/protocol";

import type {
  EventStreamCursor,
  EventStreamSink,
  EventStreamUseCases,
} from "./ports/event-stream.js";
import type { EventStreamSource } from "./ports/event-stream-source.js";

const PAGE_SIZE = 1_000;

export type EventStreamErrorCode = "INVALID_EVENT_CURSOR" | "RUN_NOT_FOUND";

export class EventStreamError extends Error {
  constructor(
    readonly code: EventStreamErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "EventStreamError";
  }
}

export class EventStreamService implements EventStreamUseCases {
  constructor(private readonly source: EventStreamSource) {}

  resolveCursor(
    context: EventProjectionContext,
    lastEventId?: string,
  ): EventStreamCursor {
    if (!this.source.hasEvents(context.runId)) {
      throw new EventStreamError("RUN_NOT_FOUND", "Run was not found.");
    }
    if (lastEventId === undefined) {
      return { sourceSequence: 0, deliverySequence: 0 };
    }

    const event = this.source.getEvent(lastEventId);
    if (
      event === undefined ||
      projectEventForAudience(event, context) === undefined
    ) {
      throw new EventStreamError(
        "INVALID_EVENT_CURSOR",
        "Event cursor is unavailable for this stream.",
      );
    }
    return {
      sourceSequence: event.sequence,
      deliverySequence: this.countVisibleEventsThrough(context, event.sequence),
    };
  }

  open(
    context: EventProjectionContext,
    cursor: EventStreamCursor,
    sink: EventStreamSink,
  ): () => void {
    let catchingUp = true;
    let lastSourceSequence = cursor.sourceSequence;
    let lastDeliverySequence = cursor.deliverySequence;
    const buffered: EventEnvelope[] = [];
    let unsubscribe = (): void => {};

    const deliver = (event: EventEnvelope): void => {
      if (
        event.runId !== context.runId ||
        event.sequence <= lastSourceSequence
      ) {
        return;
      }
      lastSourceSequence = event.sequence;
      const projected = projectEventForAudience(event, context);
      if (projected !== undefined) {
        lastDeliverySequence += 1;
        sink.send(toEventDelivery(projected, lastDeliverySequence));
      }
    };

    const receiveLive = (event: EventEnvelope): void => {
      if (catchingUp) {
        buffered.push(event);
        return;
      }
      try {
        deliver(event);
      } catch {
        unsubscribe();
        sink.close?.();
      }
    };

    unsubscribe = this.source.subscribe(context.runId, receiveLive);
    try {
      while (true) {
        const events = this.source.listEvents(
          context.runId,
          lastSourceSequence,
          PAGE_SIZE,
        );
        for (const event of events) deliver(event);
        if (events.length < PAGE_SIZE) break;
      }
      catchingUp = false;
      buffered.sort((left, right) => left.sequence - right.sequence);
      for (const event of buffered) deliver(event);
      return unsubscribe;
    } catch (error: unknown) {
      unsubscribe();
      throw error;
    }
  }

  private countVisibleEventsThrough(
    context: EventProjectionContext,
    targetSequence: number,
  ): number {
    let sourceSequence = 0;
    let deliverySequence = 0;

    while (sourceSequence < targetSequence) {
      const events = this.source.listEvents(
        context.runId,
        sourceSequence,
        PAGE_SIZE,
      );
      if (events.length === 0) {
        throw new EventStreamError(
          "INVALID_EVENT_CURSOR",
          "Event cursor is unavailable for this stream.",
        );
      }

      for (const event of events) {
        if (event.sequence > targetSequence) break;
        sourceSequence = event.sequence;
        if (projectEventForAudience(event, context) !== undefined) {
          deliverySequence += 1;
        }
      }
    }

    return deliverySequence;
  }
}

function toEventDelivery(
  event: EventEnvelope,
  deliverySequence: number,
): EventDelivery {
  const { sequence: _sourceSequence, ...deliveredEvent } = event;
  void _sourceSequence;
  return {
    deliveryVersion: EVENT_DELIVERY_VERSION,
    deliverySequence,
    event: deliveredEvent,
  };
}
