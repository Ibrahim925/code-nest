import type { CommandEnvelope } from "@code-nest/protocol";

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const ACTION_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const MAX_ACTIONS = 64;

export type CapabilityDenialReason =
  | "action_denied"
  | "actor_not_participant"
  | "command_replayed"
  | "expired"
  | "invalid_credential"
  | "participant_mismatch"
  | "revoked"
  | "run_mismatch";

export interface CapabilityIssueRequest {
  readonly runId: string;
  readonly participantId: string;
  readonly actions: readonly string[];
  readonly expiresAt: Date;
}

export interface CapabilityScope {
  readonly runId: string;
  readonly participantId: string;
  readonly actions: readonly string[];
  readonly expiresAtMilliseconds: number;
  readonly revoked: boolean;
  readonly usedCommandIds: ReadonlySet<string>;
}

export interface ValidatedCapabilityIssue {
  readonly runId: string;
  readonly participantId: string;
  readonly actions: readonly string[];
  readonly expiresAt: string;
  readonly expiresAtMilliseconds: number;
}

export function isCapabilityIdentifier(value: string): boolean {
  return IDENTIFIER_PATTERN.test(value);
}

export function validateCapabilityIssue(
  request: CapabilityIssueRequest,
  nowMilliseconds: number,
): ValidatedCapabilityIssue | undefined {
  const expiresAtMilliseconds =
    request.expiresAt instanceof Date
      ? request.expiresAt.getTime()
      : Number.NaN;
  const actions = [...new Set(request.actions)].sort();

  if (
    !isCapabilityIdentifier(request.runId) ||
    !isCapabilityIdentifier(request.participantId) ||
    request.actions.length !== actions.length ||
    actions.length < 1 ||
    actions.length > MAX_ACTIONS ||
    actions.some((action) => !ACTION_PATTERN.test(action)) ||
    !Number.isFinite(expiresAtMilliseconds) ||
    expiresAtMilliseconds <= nowMilliseconds
  ) {
    return undefined;
  }

  return {
    runId: request.runId,
    participantId: request.participantId,
    actions,
    expiresAt: new Date(expiresAtMilliseconds).toISOString(),
    expiresAtMilliseconds,
  };
}

export function evaluateCapabilityScope(
  scope: CapabilityScope,
  command: CommandEnvelope,
  nowMilliseconds: number,
): CapabilityDenialReason | undefined {
  if (scope.revoked) return "revoked";
  if (nowMilliseconds >= scope.expiresAtMilliseconds) return "expired";
  if (command.actor.kind !== "participant") return "actor_not_participant";
  if (command.runId !== scope.runId) return "run_mismatch";
  if (command.actor.id !== scope.participantId) return "participant_mismatch";
  if (!scope.actions.includes(command.kind)) return "action_denied";
  if (scope.usedCommandIds.has(command.commandId)) return "command_replayed";
  return undefined;
}
