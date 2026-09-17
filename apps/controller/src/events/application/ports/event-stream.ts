import type { EventProjectionContext } from "@code-nest/core";
import type { EventDelivery } from "@code-nest/protocol";

export interface EventStreamCursor {
  readonly sourceSequence: number;
  readonly deliverySequence: number;
}

export interface EventStreamSink {
  send(delivery: EventDelivery): void;
  close?(): void;
}

export interface EventStreamUseCases {
  resolveCursor(
    context: EventProjectionContext,
    lastEventId?: string,
  ): EventStreamCursor;
  open(
    context: EventProjectionContext,
    cursor: EventStreamCursor,
    sink: EventStreamSink,
  ): () => void;
}
