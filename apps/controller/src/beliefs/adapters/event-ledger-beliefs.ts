import {
  BeliefReportError,
  parsePrivateBeliefReport,
  type PrivateBeliefReport,
} from "@code-nest/core";
import { EVENT_SCHEMA_VERSION, type EventEnvelope } from "@code-nest/protocol";

import { projectEventForAudience } from "@code-nest/core";
import { BeliefApplicationError } from "../application/belief-service.js";
import type {
  BeliefEvidenceReader,
  BeliefJournal,
  BeliefReceipt,
} from "../application/ports/belief-ports.js";
import {
  EventLedger,
  EventLedgerError,
  type EventDraft,
} from "../../ledger/ledger.js";

const EVENT_KIND = "belief.reported";

export interface EventLedgerBeliefOptions {
  readonly createEventId: () => string;
  readonly now: () => Date;
}

function parsedReport(event: EventEnvelope): PrivateBeliefReport | undefined {
  if (event.kind !== EVENT_KIND) return undefined;
  const report = parsePrivateBeliefReport(event.payload);
  if (
    event.actor.kind !== "participant" || event.actor.id !== report.participantId ||
    event.context.phase !== "belief" || event.context.round !== report.round ||
    event.visibility.class !== "participant_private" ||
    event.visibility.recipientIds.length !== 1 ||
    event.visibility.recipientIds[0] !== report.participantId ||
    event.parentEventIds.length !== 1 ||
    event.parentEventIds[0] !== report.strongestEvidenceEventId
  ) {
    throw new BeliefApplicationError(
      "BELIEF_STORAGE_FAILED",
      "Stored belief event metadata is inconsistent.",
    );
  }
  return report;
}

function draft(
  runId: string,
  commandId: string,
  report: PrivateBeliefReport,
  eventId: string,
  recordedAt: string,
): EventDraft {
  return {
    schemaVersion: EVENT_SCHEMA_VERSION,
    eventId,
    runId,
    recordedAt,
    actor: { kind: "participant", id: report.participantId },
    context: { round: report.round, phase: "belief" },
    kind: EVENT_KIND,
    payload: {
      schemaVersion: report.schemaVersion,
      participantId: report.participantId,
      round: report.round,
      allocations: report.allocations.map((allocation) => ({ ...allocation })),
      strongestEvidenceEventId: report.strongestEvidenceEventId,
    },
    visibility: {
      class: "participant_private",
      recipientIds: [report.participantId],
    },
    causationId: commandId,
    correlationId: runId,
    parentEventIds: [report.strongestEvidenceEventId],
    artifactDigests: [],
    resourceCost: {},
  };
}

export class EventLedgerBeliefJournal implements BeliefJournal {
  constructor(
    private readonly ledger: EventLedger,
    private readonly options: EventLedgerBeliefOptions,
  ) {}

  find(runId: string, commandId: string): BeliefReceipt | undefined {
    return this.#persist(() => {
      const event = this.ledger.getCommandResult(runId, commandId);
      if (event === undefined) return undefined;
      const report = parsedReport(event);
      if (report === undefined) {
        throw new BeliefApplicationError(
          "BELIEF_COMMAND_CONFLICT",
          "Belief command ID belongs to another controller action.",
        );
      }
      return { status: "duplicate", eventId: event.eventId, report };
    });
  }

  record(runId: string, commandId: string, report: PrivateBeliefReport): BeliefReceipt {
    return this.#persist(() => {
      const result = this.ledger.appendCommandEvent(commandId, draft(
        runId, commandId, report, this.options.createEventId(), this.options.now().toISOString(),
      ));
      const stored = parsedReport(result.event);
      if (stored === undefined) {
        throw new BeliefApplicationError(
          "BELIEF_COMMAND_CONFLICT",
          "Belief command ID belongs to another controller action.",
        );
      }
      return { status: result.status === "appended" ? "accepted" : "duplicate", eventId: result.event.eventId, report: stored };
    });
  }

  #persist<T>(operation: () => T): T {
    try {
      return operation();
    } catch (error: unknown) {
      if (error instanceof EventLedgerError || error instanceof BeliefReportError) {
        throw new BeliefApplicationError(
          "BELIEF_STORAGE_FAILED",
          "Private belief storage failed.",
          error,
        );
      }
      throw error;
    }
  }
}

export class EventLedgerBeliefEvidenceReader implements BeliefEvidenceReader {
  constructor(private readonly ledger: EventLedger) {}

  isVisible(input: {
    runId: string;
    round: number;
    participantId: string;
    eventId: string;
  }): boolean {
    try {
      const event = this.ledger.getEvent(input.eventId);
      return event !== undefined && event.context.round === input.round &&
        projectEventForAudience(event, {
          runId: input.runId,
          revealState: "sealed",
          audience: { kind: "participant", participantId: input.participantId },
        }) !== undefined;
    } catch (error: unknown) {
      if (error instanceof EventLedgerError) {
        throw new BeliefApplicationError(
          "BELIEF_STORAGE_FAILED",
          "Belief evidence lookup failed.",
          error,
        );
      }
      throw error;
    }
  }
}
