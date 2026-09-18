import type {
  GovernanceBudgetState,
  GovernanceSpendDecision,
  GovernanceSpendRequest,
} from "@code-nest/core";

export interface GovernanceBudgetStore {
  spend(
    runId: string,
    request: GovernanceSpendRequest,
    now: Date,
  ): GovernanceSpendDecision;
  read(runId: string): GovernanceBudgetState;
}
