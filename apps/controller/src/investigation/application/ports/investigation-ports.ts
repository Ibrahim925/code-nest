import type { GovernanceSpendDecision } from "@code-nest/core";

import type {
  FailedInvestigationReceipt,
  InvestigationAuthorization,
  InvestigationReceipt,
  InvestigationRequest,
  InvestigationTerminalReceipt,
} from "../../domain/investigation.js";

export interface InvestigationAuthorizer {
  authorize(request: InvestigationRequest): Promise<InvestigationAuthorization>;
}

export interface InvestigationBudget {
  spend(request: {
    readonly runId: string;
    readonly commandId: string;
    readonly round: number;
    readonly action: "trusted_public_ci" | "patch_provenance" | "targeted_audit" | "full_patch_audit";
    readonly subjectId: string;
    readonly phaseDeadline: string;
  }): GovernanceSpendDecision;
}

export interface InvestigationExecutionResult {
  readonly bytes: Uint8Array;
  readonly mediaType: string;
  readonly summary: string;
}

export interface TrustedInvestigationExecutor {
  execute(request: InvestigationRequest, jobId: string): Promise<InvestigationExecutionResult>;
}

export interface InvestigationResultPublisher {
  publish(
    request: InvestigationRequest,
    authorization: InvestigationAuthorization,
    result: InvestigationExecutionResult,
  ): Promise<`sha256:${string}`>;
}

export interface InvestigationJournal {
  find(runId: string, commandId: string): InvestigationTerminalReceipt | undefined;
  complete(receipt: InvestigationReceipt): InvestigationReceipt;
  fail(receipt: FailedInvestigationReceipt): FailedInvestigationReceipt;
}
