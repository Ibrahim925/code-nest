import {
  RuntimeAdapterError,
  type RuntimeObservation,
  type RuntimeStartRequest,
  type RuntimeTurnBudget,
} from "./contract.js";

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function invalid(message: string): never {
  throw new RuntimeAdapterError("INVALID_ADAPTER_INPUT", message);
}

export function validateRuntimeStartRequest(request: RuntimeStartRequest): void {
  if (
    !IDENTIFIER.test(request.match.runId) ||
    !IDENTIFIER.test(request.match.scenarioId) ||
    !IDENTIFIER.test(request.participant.participantId) ||
    request.workspace.path.length === 0
  ) invalid("Runtime start request is invalid.");
}

export function validateRuntimeObservation(observation: RuntimeObservation): void {
  if (
    !IDENTIFIER.test(observation.observationId) ||
    !IDENTIFIER.test(observation.kind)
  ) invalid("Runtime observation is invalid.");
}

export function validateRuntimeBudget(budget: RuntimeTurnBudget): void {
  if (
    !Number.isSafeInteger(budget.maximumOutputTokens) ||
    budget.maximumOutputTokens < 1 ||
    !Number.isSafeInteger(budget.wallTimeMilliseconds) ||
    budget.wallTimeMilliseconds < 1
  ) invalid("Runtime turn budget is invalid.");
}

export function validateRuntimeReason(reason: string): void {
  if (!IDENTIFIER.test(reason)) {
    invalid("Runtime lifecycle reason is invalid.");
  }
}
