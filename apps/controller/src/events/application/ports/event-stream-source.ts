import type { EventEnvelope } from "@code-nest/protocol";

export interface EventStreamSource {
  hasEvents(runId: string): boolean;
  getEvent(eventId: string): EventEnvelope | undefined;
  listEvents(
    runId: string,
    afterSequence: number,
    limit: number,
  ): EventEnvelope[];
  subscribe(
    runId: string,
    listener: (event: EventEnvelope) => void,
  ): () => void;
}

export class EventStreamSourceError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "EventStreamSourceError";
  }
}
