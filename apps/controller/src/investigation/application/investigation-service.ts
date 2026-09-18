import { createHash } from "node:crypto";

import {
  INVESTIGATION_BUDGET_ACTIONS,
  INVESTIGATION_SCHEMA_VERSION,
  InvestigationError,
  sameInvestigationRequest,
  validateInvestigationAuthorization,
  validateInvestigationRequest,
  type InvestigationReceipt,
  type InvestigationRequest,
} from "../domain/investigation.js";
import type {
  InvestigationAuthorizer,
  InvestigationBudget,
  InvestigationJournal,
  InvestigationResultPublisher,
  TrustedInvestigationExecutor,
} from "./ports/investigation-ports.js";

export interface InvestigationServiceDependencies {
  readonly authorizer: InvestigationAuthorizer;
  readonly budget: InvestigationBudget;
  readonly executor: TrustedInvestigationExecutor;
  readonly publisher: InvestigationResultPublisher;
  readonly journal: InvestigationJournal;
}

function stableId(prefix: string, commandId: string): string {
  const digest = createHash("sha256").update(commandId).digest("hex").slice(0, 24);
  return `${prefix}-${digest}`;
}

export class InvestigationService {
  constructor(private readonly dependencies: InvestigationServiceDependencies) {}

  async request(input: InvestigationRequest): Promise<InvestigationReceipt> {
    const request = validateInvestigationRequest(input);
    const previous = this.dependencies.journal.find(
      request.runId,
      request.commandId,
    );
    if (previous !== undefined) {
      if (!sameInvestigationRequest(previous.request, request)) {
        throw new InvestigationError(
          "INVESTIGATION_COMMAND_CONFLICT",
          "Investigation command ID was already used for another request.",
        );
      }
      if (previous.status === "failed") {
        throw new InvestigationError(
          "INVESTIGATION_EXECUTION_FAILED",
          "The trusted investigation job previously failed.",
        );
      }
      return { ...previous, status: "duplicate" };
    }

    const authorization = validateInvestigationAuthorization(
      await this.dependencies.authorizer.authorize(request),
    );
    const budget = this.dependencies.budget.spend({
      runId: request.runId,
      commandId: stableId("investigation-spend", request.commandId),
      round: request.round,
      action: INVESTIGATION_BUDGET_ACTIONS[request.kind],
      subjectId: request.subjectId,
      phaseDeadline: request.phaseDeadline,
    });
    const common = {
      schemaVersion: INVESTIGATION_SCHEMA_VERSION,
      request,
      authorizationId: authorization.authorizationId,
      cost: budget.record.cost,
      remainingCredits: budget.record.remainingCredits,
      visibility: authorization.visibility,
    } as const;

    try {
      const result = await this.dependencies.executor.execute(
        request,
        stableId("investigation-job", request.commandId),
      );
      const resultDigest = await this.dependencies.publisher.publish(
        request,
        authorization,
        result,
      );
      return this.dependencies.journal.complete({
        ...common,
        status: "completed",
        resultDigest,
        summary: result.summary,
      });
    } catch (error: unknown) {
      this.dependencies.journal.fail({ ...common, status: "failed" });
      throw new InvestigationError(
        "INVESTIGATION_EXECUTION_FAILED",
        "The trusted investigation job failed.",
        error,
      );
    }
  }
}
