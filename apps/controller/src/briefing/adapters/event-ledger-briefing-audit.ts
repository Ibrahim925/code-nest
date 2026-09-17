import { createHash, randomUUID } from "node:crypto";

import { EVENT_SCHEMA_VERSION } from "@code-nest/protocol";

import type {
  BriefingAttemptStatus,
  BriefingAudit,
} from "../application/ports/briefing-audit.js";
import {
  BriefingError,
  type BriefingReceipt,
} from "../domain/brief.js";
import {
  EventLedger,
  type EventDraft,
} from "../../ledger/ledger.js";

export interface EventLedgerBriefingAuditOptions {
  readonly createEventId?: () => string;
  readonly now?: () => Date;
}

function runKey(runId: string): string {
  return createHash("sha256").update(runId).digest("hex").slice(0, 24);
}

function eventDraft(
  receipt: BriefingReceipt,
  kind: "delivery_started" | "completed",
  commandId: string,
  eventId: string,
  recordedAt: string,
): EventDraft {
  return {
    schemaVersion: EVENT_SCHEMA_VERSION,
    eventId,
    runId: receipt.runId,
    recordedAt,
    actor: { kind: "controller", id: "briefing-service" },
    context: { round: 1, phase: "briefing" },
    kind: `briefing.${kind}`,
    payload: {
      assignments: receipt.assignments.map((assignment) => ({ ...assignment })),
    },
    visibility:
      kind === "completed"
        ? { class: "public" }
        : { class: "operator_private" },
    causationId: commandId,
    correlationId: `briefing-${runKey(receipt.runId)}`,
    parentEventIds: [],
    artifactDigests: [],
    resourceCost: {},
  };
}

export class EventLedgerBriefingAudit implements BriefingAudit {
  readonly #createEventId: () => string;
  readonly #now: () => Date;

  constructor(
    private readonly ledger: EventLedger,
    options: EventLedgerBriefingAuditOptions = {},
  ) {
    this.#createEventId = options.createEventId ?? randomUUID;
    this.#now = options.now ?? (() => new Date());
  }

  async beginAttempt(
    receipt: BriefingReceipt,
  ): Promise<BriefingAttemptStatus> {
    if (this.ledger.listEvents(receipt.runId, { limit: 1 }).length === 0) {
      throw new BriefingError(
        "BRIEFING_AUDIT_FAILED",
        "Private briefing requires an existing run.",
      );
    }
    const commandId = `briefing-begin-${runKey(receipt.runId)}`;
    try {
      const result = this.ledger.appendCommandEvent(
        commandId,
        eventDraft(
          receipt,
          "delivery_started",
          commandId,
          this.#createEventId(),
          this.#now().toISOString(),
        ),
      );
      return result.status === "appended"
        ? { status: "started" }
        : { status: "already_started" };
    } catch (error: unknown) {
      throw this.#failure(error);
    }
  }

  async complete(receipt: BriefingReceipt): Promise<void> {
    const commandId = `briefing-complete-${runKey(receipt.runId)}`;
    try {
      this.ledger.appendCommandEvent(
        commandId,
        eventDraft(
          receipt,
          "completed",
          commandId,
          this.#createEventId(),
          this.#now().toISOString(),
        ),
      );
    } catch (error: unknown) {
      throw this.#failure(error);
    }
  }

  #failure(error: unknown): BriefingError {
    return new BriefingError(
      "BRIEFING_AUDIT_FAILED",
      "Private briefing audit event could not be persisted.",
      error,
    );
  }
}
