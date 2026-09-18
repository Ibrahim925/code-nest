import type {
  DecodedEventDelivery,
  SseEventFrame,
} from "../../domain/live-events.js";

export interface EventStreamRequest {
  readonly runId: string;
  readonly bearerToken: string;
  readonly lastEventId?: string;
  readonly signal: AbortSignal;
}

export interface EventStreamTransport {
  open(request: EventStreamRequest): Promise<AsyncIterable<SseEventFrame>>;
}

export interface EventDeliveryDecoder {
  decode(frame: SseEventFrame): DecodedEventDelivery;
}

export class EventStreamTransportError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly recoverable: boolean,
  ) {
    super(message);
    this.name = "EventStreamTransportError";
  }
}
