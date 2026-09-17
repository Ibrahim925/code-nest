import type { EventEnvelope } from "@code-nest/protocol";

import { EventLedger, EventLedgerError } from "../../ledger/ledger.js";
import {
  EventStreamSourceError,
  type EventStreamSource,
} from "../application/ports/event-stream-source.js";

export class EventLedgerEventSource implements EventStreamSource {
  constructor(private readonly ledger: EventLedger) {}

  hasEvents(runId: string): boolean {
    return this.#read(
      () => this.ledger.listEvents(runId, { limit: 1 }).length > 0,
    );
  }

  getEvent(eventId: string): EventEnvelope | undefined {
    return this.#read(() => this.ledger.getEvent(eventId));
  }

  listEvents(
    runId: string,
    afterSequence: number,
    limit: number,
  ): EventEnvelope[] {
    return this.#read(() =>
      this.ledger.listEvents(runId, { afterSequence, limit }),
    );
  }

  subscribe(
    runId: string,
    listener: (event: EventEnvelope) => void,
  ): () => void {
    return this.ledger.subscribe(runId, listener);
  }

  #read<T>(operation: () => T): T {
    try {
      return operation();
    } catch (error: unknown) {
      if (error instanceof EventLedgerError) {
        throw new EventStreamSourceError("Event stream storage failed.", error);
      }
      throw error;
    }
  }
}
