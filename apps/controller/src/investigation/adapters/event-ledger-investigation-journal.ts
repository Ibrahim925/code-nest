import { createHash } from "node:crypto";

import { EVENT_SCHEMA_VERSION, type EventEnvelope } from "@code-nest/protocol";

import type {
  FailedInvestigationReceipt,
  InvestigationReceipt,
  InvestigationTerminalReceipt,
} from "../domain/investigation.js";
import { parseInvestigationTerminalReceipt } from "../domain/investigation.js";
import type { InvestigationJournal } from "../application/ports/investigation-ports.js";
import { EventLedger, type EventDraft } from "../../ledger/ledger.js";

export interface EventLedgerInvestigationJournalOptions {
  readonly createEventId: () => string;
  readonly now: () => Date;
}

function commandId(status: "completed" | "failed", sourceId: string): string {
  const digest = createHash("sha256").update(sourceId).digest("hex").slice(0, 24);
  return `investigation-${status}-${digest}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jsonPayload(value: unknown): EventDraft["payload"] {
  return JSON.parse(JSON.stringify(value)) as EventDraft["payload"];
}

function receipt(event: EventEnvelope | undefined): InvestigationTerminalReceipt | undefined {
  if (
    event === undefined ||
    (event.kind !== "investigation.completed" && event.kind !== "investigation.failed") ||
    !isRecord(event.payload) ||
    !isRecord(event.payload.receipt)
  ) {
    return undefined;
  }
  return parseInvestigationTerminalReceipt(event.payload.receipt);
}

function eventDraft(
  value: InvestigationTerminalReceipt,
  eventId: string,
  recordedAt: string,
): EventDraft {
  const status = value.status === "failed" ? "failed" : "completed";
  const internalCommandId = commandId(status, value.request.commandId);
  return {
    schemaVersion: EVENT_SCHEMA_VERSION,
    eventId,
    runId: value.request.runId,
    recordedAt,
    actor: { kind: "controller", id: "investigation-service" },
    context: { round: value.request.round, phase: "evidence" },
    kind: `investigation.${status}`,
    payload: jsonPayload({ receipt: value }),
    visibility: value.visibility,
    causationId: internalCommandId,
    correlationId: value.request.commandId,
    parentEventIds: [],
    artifactDigests: value.status === "failed" ? [] : [value.resultDigest],
    resourceCost: {},
  };
}

export class EventLedgerInvestigationJournal implements InvestigationJournal {
  constructor(
    private readonly ledger: EventLedger,
    private readonly options: EventLedgerInvestigationJournalOptions,
  ) {}

  find(runId: string, sourceCommandId: string): InvestigationTerminalReceipt | undefined {
    return receipt(this.ledger.getCommandResult(
      runId,
      commandId("completed", sourceCommandId),
    )) ?? receipt(this.ledger.getCommandResult(
      runId,
      commandId("failed", sourceCommandId),
    ));
  }

  complete(value: InvestigationReceipt): InvestigationReceipt {
    const id = commandId("completed", value.request.commandId);
    const result = this.ledger.appendCommandEvent(
      id,
      eventDraft(value, this.options.createEventId(), this.options.now().toISOString()),
    );
    const stored = receipt(result.event);
    if (stored === undefined || stored.status === "failed") {
      throw new Error("Investigation completion receipt could not be recovered.");
    }
    return { ...stored, status: value.status };
  }

  fail(value: FailedInvestigationReceipt): FailedInvestigationReceipt {
    const id = commandId("failed", value.request.commandId);
    const result = this.ledger.appendCommandEvent(
      id,
      eventDraft(value, this.options.createEventId(), this.options.now().toISOString()),
    );
    const stored = receipt(result.event);
    if (stored === undefined || stored.status !== "failed") {
      throw new Error("Investigation failure receipt could not be recovered.");
    }
    return stored;
  }
}
