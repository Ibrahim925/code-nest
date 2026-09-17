import type { EventEnvelope } from "@code-nest/protocol";

export type EventDraft = Omit<EventEnvelope, "sequence">;

export type EventLedgerErrorCode =
  | "CAUSATION_MISMATCH"
  | "CORRUPT_STORED_EVENT"
  | "EVENT_ID_CONFLICT"
  | "INVALID_EVENT"
  | "INVALID_QUERY"
  | "UNSUPPORTED_DATABASE_SCHEMA"
  | "WAL_UNAVAILABLE"
  | "WRITE_FAILED";

export class EventLedgerError extends Error {
  constructor(
    readonly code: EventLedgerErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "EventLedgerError";
  }
}

export interface AppendEventResult {
  status: "appended" | "duplicate";
  event: EventEnvelope;
}

export interface ListEventsOptions {
  afterSequence?: number;
  limit?: number;
}

export type EventListener = (event: EventEnvelope) => void;
