import { randomUUID } from "node:crypto";

import { EVENT_SCHEMA_VERSION } from "@code-nest/protocol";

import {
  CapabilityAuditError,
  type CapabilityAuditEntry,
  type CapabilityAuditPort,
} from "../application/ports/capability-audit.js";
import {
  EventLedger,
  EventLedgerError,
  type EventDraft,
} from "../../ledger/ledger.js";

export interface EventLedgerCapabilityAuditOptions {
  readonly createEventId?: () => string;
  readonly createAuditId?: () => string;
}

export class EventLedgerCapabilityAudit implements CapabilityAuditPort {
  readonly #createEventId: () => string;
  readonly #createAuditId: () => string;

  constructor(
    private readonly ledger: EventLedger,
    options: EventLedgerCapabilityAuditOptions = {},
  ) {
    this.#createEventId = options.createEventId ?? randomUUID;
    this.#createAuditId = options.createAuditId ?? randomUUID;
  }

  record(entry: CapabilityAuditEntry): void {
    const auditId = this.#createAuditId();
    try {
      if (this.ledger.listEvents(entry.runId, { limit: 1 }).length === 0) {
        throw new CapabilityAuditError(
          "Capability audit requires an existing run.",
        );
      }
      this.ledger.appendCommandEvent(
        auditId,
        eventDraft(entry, auditId, this.#createEventId()),
      );
    } catch (error: unknown) {
      if (error instanceof EventLedgerError) {
        throw new CapabilityAuditError(
          "Capability audit event could not be persisted.",
          error,
        );
      }
      throw error;
    }
  }
}

function eventDraft(
  entry: CapabilityAuditEntry,
  auditId: string,
  eventId: string,
): EventDraft {
  return {
    schemaVersion: EVENT_SCHEMA_VERSION,
    eventId,
    runId: entry.runId,
    recordedAt: entry.recordedAt,
    actor: { kind: "controller", id: "capability-authority" },
    context: { round: null, phase: null },
    kind: `capability.${entry.kind}`,
    payload: auditPayload(entry),
    visibility: { class: "operator_private" },
    causationId: auditId,
    correlationId:
      entry.kind === "rejected" ? entry.requestCommandId : entry.tokenId,
    parentEventIds: [],
    artifactDigests: [],
    resourceCost: {},
  };
}

function auditPayload(entry: CapabilityAuditEntry) {
  switch (entry.kind) {
    case "issued":
      return {
        tokenId: entry.tokenId,
        participantId: entry.participantId,
        actions: [...entry.actions],
        expiresAt: entry.expiresAt,
      };
    case "rejected":
      return {
        tokenId: entry.tokenId,
        participantId: entry.participantId,
        reason: entry.reason,
        requestCommandId: entry.requestCommandId,
        requestedAction: entry.requestedAction,
        claimedRunId: entry.claimedRunId,
        claimedParticipantId: entry.claimedParticipantId,
        claimedTokenId: entry.claimedTokenId,
      };
    case "revoked":
      return {
        tokenId: entry.tokenId,
        participantId: entry.participantId,
        reason: entry.reason,
      };
  }
}
