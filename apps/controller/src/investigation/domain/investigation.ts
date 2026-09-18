import type { Visibility } from "@code-nest/core";

export const INVESTIGATION_SCHEMA_VERSION = "1.0" as const;

export const INVESTIGATION_BUDGET_ACTIONS = {
  public_ci: "trusted_public_ci",
  provenance: "patch_provenance",
  targeted_audit: "targeted_audit",
  full_audit: "full_patch_audit",
} as const;

export type InvestigationKind = keyof typeof INVESTIGATION_BUDGET_ACTIONS;
const IDENTIFIER_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/;

export class InvestigationError extends Error {
  constructor(
    readonly code:
      | "INVESTIGATION_COMMAND_CONFLICT"
      | "INVESTIGATION_EXECUTION_FAILED"
      | "INVALID_INVESTIGATION_REQUEST"
      | "UNAUTHORIZED_INVESTIGATION",
    message: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "InvestigationError";
  }
}

export interface InvestigationRequest {
  readonly runId: string;
  readonly commandId: string;
  readonly participantId: string;
  readonly round: number;
  readonly kind: InvestigationKind;
  readonly subjectId: string;
  readonly phaseDeadline: string;
}

export interface InvestigationAuthorization {
  readonly authorizationId: string;
  readonly visibility: Visibility;
}

export interface InvestigationReceipt {
  readonly schemaVersion: typeof INVESTIGATION_SCHEMA_VERSION;
  readonly status: "completed" | "duplicate";
  readonly request: InvestigationRequest;
  readonly authorizationId: string;
  readonly cost: number;
  readonly remainingCredits: number;
  readonly resultDigest: `sha256:${string}`;
  readonly summary: string;
  readonly visibility: Visibility;
}

export interface FailedInvestigationReceipt {
  readonly schemaVersion: typeof INVESTIGATION_SCHEMA_VERSION;
  readonly status: "failed";
  readonly request: InvestigationRequest;
  readonly authorizationId: string;
  readonly cost: number;
  readonly remainingCredits: number;
  readonly visibility: Visibility;
}

export type InvestigationTerminalReceipt =
  | InvestigationReceipt
  | FailedInvestigationReceipt;

function invalid(message: string): never {
  throw new InvestigationError("INVALID_INVESTIGATION_REQUEST", message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validVisibility(value: unknown): value is Visibility {
  if (!isRecord(value) || typeof value.class !== "string") return false;
  if (
    value.class === "public" ||
    value.class === "operator_private" ||
    value.class === "post_reveal"
  ) {
    return Object.keys(value).length === 1;
  }
  return (
    (value.class === "participant_private" || value.class === "covert") &&
    Object.keys(value).length === 2 &&
    Array.isArray(value.recipientIds) &&
    value.recipientIds.length > 0 &&
    value.recipientIds.length <= 64 &&
    value.recipientIds.every(
      (recipient) =>
        typeof recipient === "string" && IDENTIFIER_PATTERN.test(recipient),
    ) &&
    new Set(value.recipientIds).size === value.recipientIds.length
  );
}

export function validateInvestigationRequest(
  request: InvestigationRequest,
): InvestigationRequest {
  if (
    typeof request.runId !== "string" ||
    typeof request.commandId !== "string" ||
    typeof request.participantId !== "string" ||
    typeof request.subjectId !== "string" ||
    !IDENTIFIER_PATTERN.test(request.runId) ||
    !IDENTIFIER_PATTERN.test(request.commandId) ||
    !IDENTIFIER_PATTERN.test(request.participantId) ||
    !IDENTIFIER_PATTERN.test(request.subjectId) ||
    !Number.isSafeInteger(request.round) ||
    request.round < 1 ||
    !Object.hasOwn(INVESTIGATION_BUDGET_ACTIONS, request.kind) ||
    typeof request.phaseDeadline !== "string"
  ) {
    return invalid("Investigation request is malformed.");
  }
  return { ...request };
}

export function sameInvestigationRequest(
  left: InvestigationRequest,
  right: InvestigationRequest,
): boolean {
  return left.runId === right.runId &&
    left.commandId === right.commandId &&
    left.participantId === right.participantId &&
    left.round === right.round &&
    left.kind === right.kind &&
    left.subjectId === right.subjectId &&
    left.phaseDeadline === right.phaseDeadline;
}

export function validateInvestigationAuthorization(
  authorization: InvestigationAuthorization,
): InvestigationAuthorization {
  if (
    typeof authorization.authorizationId !== "string" ||
    !IDENTIFIER_PATTERN.test(authorization.authorizationId) ||
    !validVisibility(authorization.visibility)
  ) {
    return invalid("Investigation authorization is malformed.");
  }
  return structuredClone(authorization);
}

export function parseInvestigationTerminalReceipt(
  value: unknown,
): InvestigationTerminalReceipt {
  if (
    !isRecord(value) ||
    value.schemaVersion !== INVESTIGATION_SCHEMA_VERSION ||
    (value.status !== "completed" && value.status !== "failed") ||
    !isRecord(value.request) ||
    typeof value.authorizationId !== "string" ||
    !IDENTIFIER_PATTERN.test(value.authorizationId) ||
    typeof value.cost !== "number" ||
    !Number.isSafeInteger(value.cost) ||
    value.cost < 1 ||
    typeof value.remainingCredits !== "number" ||
    !Number.isSafeInteger(value.remainingCredits) ||
    value.remainingCredits < 0 ||
    !validVisibility(value.visibility)
  ) {
    return invalid("Stored investigation receipt is malformed.");
  }
  const request = validateInvestigationRequest(
    value.request as unknown as InvestigationRequest,
  );
  const common = {
    schemaVersion: INVESTIGATION_SCHEMA_VERSION,
    request,
    authorizationId: value.authorizationId,
    cost: value.cost,
    remainingCredits: value.remainingCredits,
    visibility: structuredClone(value.visibility),
  } as const;
  if (value.status === "failed") return { ...common, status: "failed" };
  if (
    typeof value.resultDigest !== "string" ||
    !/^sha256:[a-f0-9]{64}$/.test(value.resultDigest) ||
    typeof value.summary !== "string"
  ) {
    return invalid("Stored investigation completion is malformed.");
  }
  return {
    ...common,
    status: "completed",
    resultDigest: value.resultDigest as `sha256:${string}`,
    summary: value.summary,
  };
}
