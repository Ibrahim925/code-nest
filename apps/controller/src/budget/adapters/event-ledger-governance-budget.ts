import {
  decideGovernanceSpend,
  governanceBudgetState,
  GovernanceBudgetError,
  type GovernanceBudgetState,
  type GovernanceSpendDecision,
  type GovernanceSpendRecord,
  type GovernanceSpendRequest,
} from "@code-nest/core";
import { EVENT_SCHEMA_VERSION, type EventEnvelope } from "@code-nest/protocol";

import {
  GovernanceBudgetApplicationError,
} from "../application/governance-budget.js";
import type { GovernanceBudgetStore } from "../application/ports/governance-budget-store.js";
import {
  EventLedger,
  EventLedgerError,
  type EventDraft,
} from "../../ledger/ledger.js";

const EVENT_KIND = "governance.credits_spent";

export interface EventLedgerGovernanceBudgetOptions {
  readonly createEventId: () => string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function spendRecord(event: EventEnvelope): GovernanceSpendRecord | undefined {
  if (event.kind !== EVENT_KIND) return undefined;
  if (!isRecord(event.payload)) {
    throw new GovernanceBudgetError(
      "INVALID_GOVERNANCE_SPEND",
      "Stored governance spend payload is invalid.",
    );
  }
  const value = event.payload;
  const record = {
    commandId: event.causationId,
    round: value.round,
    action: value.action,
    subjectId: value.subjectId,
    phaseDeadline: value.phaseDeadline,
    cost: value.cost,
    remainingCredits: value.remainingCredits,
  } as GovernanceSpendRecord;
  return record;
}

function eventDraft(
  runId: string,
  record: GovernanceSpendRecord,
  eventId: string,
  recordedAt: string,
): EventDraft {
  return {
    schemaVersion: EVENT_SCHEMA_VERSION,
    eventId,
    runId,
    recordedAt,
    actor: { kind: "controller", id: "governance-budget" },
    context: { round: record.round, phase: "governance" },
    kind: EVENT_KIND,
    payload: {
      round: record.round,
      action: record.action,
      subjectId: record.subjectId,
      phaseDeadline: record.phaseDeadline,
      cost: record.cost,
      remainingCredits: record.remainingCredits,
    },
    visibility: { class: "public" },
    causationId: record.commandId,
    correlationId: runId,
    parentEventIds: [],
    artifactDigests: [],
    resourceCost: { governanceCredits: record.cost },
  };
}

export class EventLedgerGovernanceBudget implements GovernanceBudgetStore {
  constructor(
    private readonly ledger: EventLedger,
    private readonly options: EventLedgerGovernanceBudgetOptions,
  ) {}

  spend(
    runId: string,
    request: GovernanceSpendRequest,
    now: Date,
  ): GovernanceSpendDecision {
    return this.#persist(() => {
      const state = this.#state(runId);
      const decision = decideGovernanceSpend(state, request, now);
      if (decision.status === "duplicate") return decision;
      const result = this.ledger.appendCommandEvent(
        request.commandId,
        eventDraft(
          runId,
          decision.record,
          this.options.createEventId(),
          now.toISOString(),
        ),
      );
      if (result.status === "duplicate") {
        const existing = spendRecord(result.event);
        if (existing === undefined) {
          throw new GovernanceBudgetError(
            "DUPLICATE_COMMAND_CONFLICT",
            "Governance command ID belongs to another controller action.",
          );
        }
        return decideGovernanceSpend(this.#state(runId), request, now);
      }
      return decision;
    });
  }

  read(runId: string): GovernanceBudgetState {
    return this.#persist(() => this.#state(runId));
  }

  #state(runId: string): GovernanceBudgetState {
    const events: EventEnvelope[] = [];
    let afterSequence = 0;
    while (true) {
      const page = this.ledger.listEvents(runId, { afterSequence, limit: 1_000 });
      if (page.length === 0) break;
      events.push(...page);
      afterSequence = page.at(-1)?.sequence ?? afterSequence;
      if (page.length < 1_000) break;
    }
    if (events.length === 0) {
      throw new GovernanceBudgetApplicationError(
        "BUDGET_RUN_NOT_FOUND",
        "Governance budget requires an existing run.",
      );
    }
    return governanceBudgetState(
      events.flatMap((event) => {
        const record = spendRecord(event);
        return record === undefined ? [] : [record];
      }),
    );
  }

  #persist<T>(operation: () => T): T {
    try {
      return operation();
    } catch (error: unknown) {
      if (error instanceof EventLedgerError) {
        throw new GovernanceBudgetApplicationError(
          "BUDGET_STORAGE_FAILED",
          "Governance budget storage failed.",
          error,
        );
      }
      throw error;
    }
  }
}
