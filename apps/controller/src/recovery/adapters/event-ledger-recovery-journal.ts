import { isDeepStrictEqual } from "node:util";

import { EVENT_SCHEMA_VERSION, type JsonValue } from "@code-nest/protocol";

import { EventLedger, type EventDraft } from "../../ledger/ledger.js";
import type {
  RecoveryJournal,
  RecoveryReceipt,
} from "../application/ports/recovery-journal.js";
import type { RecoveryOutcome } from "../domain/recovery-outcome.js";

export interface EventLedgerRecoveryJournalOptions {
  readonly createEventId: () => string;
  readonly now: () => Date;
}

const REASONS = new Set([
  "adapter_crash", "controller_restart", "out_of_memory", "model_timeout",
  "invalid_input", "manual_intervention", "operator_cancellation",
  "policy_violation", "cleanup_failure",
]);
const STATUSES = new Set(["recovered", "failed", "rejected", "intervened", "cancelled"]);

function payload(outcome: RecoveryOutcome): JsonValue {
  return { ...outcome };
}

function eventDraft(
  runId: string,
  commandId: string,
  outcome: RecoveryOutcome,
  options: EventLedgerRecoveryJournalOptions,
): EventDraft {
  return {
    schemaVersion: EVENT_SCHEMA_VERSION,
    eventId: options.createEventId(),
    runId,
    recordedAt: options.now().toISOString(),
    actor: { kind: "controller", id: "recovery-coordinator" },
    context: { round: null, phase: null },
    kind: "recovery.outcome_recorded",
    payload: payload(outcome),
    visibility: { class: "public" },
    causationId: commandId,
    correlationId: runId,
    parentEventIds: [],
    artifactDigests: [],
    resourceCost: {},
  };
}

function isOutcome(value: unknown): value is RecoveryOutcome {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  const keys = Object.keys(candidate).sort();
  const expected = [
    "lastDurableSequence",
    "participantId",
    "reason",
    "retryRequired",
    "schemaVersion",
    "status",
    "summary",
  ].sort();
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]) &&
    candidate.schemaVersion === "1.0" && REASONS.has(String(candidate.reason)) &&
    STATUSES.has(String(candidate.status)) && typeof candidate.summary === "string" &&
    candidate.summary.length > 0 && candidate.summary.length <= 200 &&
    typeof candidate.retryRequired === "boolean" &&
    (candidate.participantId === null || typeof candidate.participantId === "string") &&
    (candidate.lastDurableSequence === null || Number.isSafeInteger(candidate.lastDurableSequence));
}

export class EventLedgerRecoveryJournal implements RecoveryJournal {
  constructor(
    private readonly ledger: EventLedger,
    private readonly options: EventLedgerRecoveryJournalOptions,
  ) {}

  async record(request: {
    readonly runId: string;
    readonly commandId: string;
    readonly outcome: RecoveryOutcome;
  }): Promise<RecoveryReceipt> {
    if (this.ledger.listEvents(request.runId, { limit: 1 }).length === 0) {
      throw new Error("Recovery outcome belongs to an unknown run.");
    }
    const result = this.ledger.appendCommandEvent(
      request.commandId,
      eventDraft(request.runId, request.commandId, request.outcome, this.options),
    );
    if (result.event.kind !== "recovery.outcome_recorded" || !isOutcome(result.event.payload)) {
      throw new Error("Recovery command did not resolve to a recovery outcome.");
    }
    if (result.status === "duplicate" && !isDeepStrictEqual(result.event.payload, request.outcome)) {
      throw new Error("Recovery idempotency key was reused for a different outcome.");
    }
    return {
      eventId: result.event.eventId,
      duplicate: result.status === "duplicate",
      outcome: result.event.payload,
    };
  }
}
