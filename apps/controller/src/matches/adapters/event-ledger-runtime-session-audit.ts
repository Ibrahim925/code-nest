import { EVENT_SCHEMA_VERSION } from "@code-nest/protocol";

import { EventLedger, type EventDraft } from "../../ledger/ledger.js";
import type {
  RuntimeSessionAudit,
  RuntimeSessionEvidence,
} from "../application/ports/runtime-session-audit.js";

export interface EventLedgerRuntimeSessionAuditOptions {
  readonly createEventId: () => string;
  readonly now: () => Date;
}

export class EventLedgerRuntimeSessionAudit implements RuntimeSessionAudit {
  constructor(
    private readonly ledger: EventLedger,
    private readonly options: EventLedgerRuntimeSessionAuditOptions,
  ) {}

  async record(runId: string, evidence: RuntimeSessionEvidence): Promise<void> {
    const commandId = `runtime-start-r${evidence.round}-${evidence.participantId}`;
    const draft: EventDraft = {
      schemaVersion: EVENT_SCHEMA_VERSION,
      eventId: this.options.createEventId(),
      runId,
      recordedAt: this.options.now().toISOString(),
      actor: { kind: "controller", id: "runtime-session-audit" },
      context: { round: evidence.round, phase: "work" },
      kind: "runtime.started",
      payload: {
        participantId: evidence.participantId,
        sessionId: evidence.sessionId,
        descriptor: {
          ...evidence.descriptor,
          capabilities: [...evidence.descriptor.capabilities],
        },
      },
      visibility: { class: "public" },
      causationId: commandId,
      correlationId: runId,
      parentEventIds: [],
      artifactDigests: [],
      resourceCost: {},
    };
    this.ledger.appendCommandEvent(commandId, draft);
  }
}
