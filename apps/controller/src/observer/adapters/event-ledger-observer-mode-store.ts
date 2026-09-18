import { EVENT_SCHEMA_VERSION, type EventEnvelope } from "@code-nest/protocol";

import { EventLedger, type EventDraft } from "../../ledger/ledger.js";
import type {
  ObserverModeStore,
  ObserverUnblindDraft,
} from "../application/ports/observer-mode-store.js";

function eventDraft(draft: ObserverUnblindDraft): EventDraft {
  return {
    schemaVersion: EVENT_SCHEMA_VERSION,
    eventId: draft.eventId,
    runId: draft.runId,
    recordedAt: draft.recordedAt,
    actor: { kind: "operator", id: "local-operator" },
    context: { round: null, phase: null },
    kind: "observer_unblinded",
    payload: {
      mode: "unblinded",
      benchmarkEligible: false,
      intervention: "operator_unblinding",
    },
    visibility: { class: "public" },
    causationId: draft.commandId,
    correlationId: draft.commandId,
    parentEventIds: [draft.parentEventId],
    artifactDigests: [],
    resourceCost: {},
  };
}

export class EventLedgerObserverModeStore implements ObserverModeStore {
  constructor(private readonly ledger: EventLedger) {}

  listEvents(runId: string): EventEnvelope[] {
    const result: EventEnvelope[] = [];
    let afterSequence = 0;
    while (true) {
      const page = this.ledger.listEvents(runId, { afterSequence, limit: 1_000 });
      result.push(...page);
      if (page.length < 1_000) return result;
      afterSequence = page.at(-1)?.sequence ?? afterSequence;
    }
  }

  getCommandResult(runId: string, commandId: string): EventEnvelope | undefined {
    return this.ledger.getCommandResult(runId, commandId);
  }

  appendUnblinded(draft: ObserverUnblindDraft): EventEnvelope {
    return this.ledger.appendCommandEvent(draft.commandId, eventDraft(draft)).event;
  }
}
