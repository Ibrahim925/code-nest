import type {
  GovernanceBudgetState,
  GovernanceSpendDecision,
  GovernanceSpendRequest,
} from "@code-nest/core";

import type { GovernanceBudgetStore } from "./ports/governance-budget-store.js";

const IDENTIFIER_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/;

export class GovernanceBudgetApplicationError extends Error {
  constructor(
    readonly code:
      | "BUDGET_RUN_NOT_FOUND"
      | "BUDGET_STORAGE_FAILED"
      | "INVALID_BUDGET_RUN",
    message: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "GovernanceBudgetApplicationError";
  }
}

export interface SpendGovernanceCreditsRequest extends GovernanceSpendRequest {
  readonly runId: string;
}

export class GovernanceBudgetService {
  constructor(
    private readonly store: GovernanceBudgetStore,
    private readonly now: () => Date,
  ) {}

  spend(request: SpendGovernanceCreditsRequest): GovernanceSpendDecision {
    this.#runId(request.runId);
    const { runId, ...spend } = request;
    return this.store.spend(runId, spend, this.now());
  }

  balance(runId: string): GovernanceBudgetState {
    this.#runId(runId);
    return this.store.read(runId);
  }

  #runId(runId: string): void {
    if (!IDENTIFIER_PATTERN.test(runId)) {
      throw new GovernanceBudgetApplicationError(
        "INVALID_BUDGET_RUN",
        "Governance budget run ID is invalid.",
      );
    }
  }
}
