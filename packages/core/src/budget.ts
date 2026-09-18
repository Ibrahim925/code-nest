export const DEFAULT_GOVERNANCE_CREDITS = 18;

export const GOVERNANCE_ACTION_COSTS = {
  trusted_public_ci: 1,
  patch_provenance: 1,
  targeted_audit: 2,
  full_patch_audit: 4,
  revert_patch: 2,
} as const;

export type GovernanceAction = keyof typeof GOVERNANCE_ACTION_COSTS;

const IDENTIFIER_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/;

export type GovernanceBudgetErrorCode =
  | "DUPLICATE_COMMAND_CONFLICT"
  | "INSUFFICIENT_GOVERNANCE_CREDITS"
  | "INVALID_GOVERNANCE_SPEND"
  | "LATE_GOVERNANCE_SPEND";

export class GovernanceBudgetError extends Error {
  constructor(
    readonly code: GovernanceBudgetErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "GovernanceBudgetError";
  }
}

export interface GovernanceSpendRequest {
  readonly commandId: string;
  readonly round: number;
  readonly action: GovernanceAction;
  readonly subjectId: string;
  readonly phaseDeadline: string;
}

export interface GovernanceSpendRecord extends GovernanceSpendRequest {
  readonly cost: number;
  readonly remainingCredits: number;
}

export interface GovernanceBudgetState {
  readonly initialCredits: number;
  readonly spentCredits: number;
  readonly remainingCredits: number;
  readonly spends: readonly GovernanceSpendRecord[];
}

export interface GovernanceSpendDecision {
  readonly status: "accepted" | "duplicate";
  readonly record: GovernanceSpendRecord;
}

function invalid(message: string): never {
  throw new GovernanceBudgetError("INVALID_GOVERNANCE_SPEND", message);
}

function validTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    return false;
  }
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value;
}

function validateRequest(request: GovernanceSpendRequest): void {
  if (
    typeof request.commandId !== "string" ||
    !IDENTIFIER_PATTERN.test(request.commandId) ||
    typeof request.round !== "number" ||
    !Number.isSafeInteger(request.round) ||
    request.round < 1 ||
    typeof request.action !== "string" ||
    typeof request.subjectId !== "string" ||
    !IDENTIFIER_PATTERN.test(request.subjectId) ||
    !Object.hasOwn(GOVERNANCE_ACTION_COSTS, request.action) ||
    !validTimestamp(request.phaseDeadline)
  ) {
    return invalid("Governance spend request is malformed.");
  }
}

function sameRequest(
  record: GovernanceSpendRecord,
  request: GovernanceSpendRequest,
): boolean {
  return record.action === request.action &&
    record.round === request.round &&
    record.subjectId === request.subjectId &&
    record.phaseDeadline === request.phaseDeadline;
}

export function governanceBudgetState(
  spends: readonly GovernanceSpendRecord[],
): GovernanceBudgetState {
  let remainingCredits = DEFAULT_GOVERNANCE_CREDITS;
  const commandIds = new Set<string>();
  const copied = spends.map((record) => {
    validateRequest(record);
    const expectedCost = GOVERNANCE_ACTION_COSTS[record.action];
    if (
      commandIds.has(record.commandId) ||
      record.cost !== expectedCost ||
      record.remainingCredits !== remainingCredits - expectedCost ||
      record.remainingCredits < 0
    ) {
      return invalid("Governance spend history is inconsistent.");
    }
    commandIds.add(record.commandId);
    remainingCredits = record.remainingCredits;
    return { ...record };
  });
  return {
    initialCredits: DEFAULT_GOVERNANCE_CREDITS,
    spentCredits: DEFAULT_GOVERNANCE_CREDITS - remainingCredits,
    remainingCredits,
    spends: copied,
  };
}

export function decideGovernanceSpend(
  state: GovernanceBudgetState,
  request: GovernanceSpendRequest,
  now: Date,
): GovernanceSpendDecision {
  validateRequest(request);
  if (!Number.isFinite(now.getTime())) return invalid("Controller time is invalid.");

  const previous = state.spends.find(({ commandId }) => commandId === request.commandId);
  if (previous !== undefined) {
    if (!sameRequest(previous, request)) {
      throw new GovernanceBudgetError(
        "DUPLICATE_COMMAND_CONFLICT",
        "Governance command ID was already used for another request.",
      );
    }
    return { status: "duplicate", record: { ...previous } };
  }

  if (now.getTime() >= Date.parse(request.phaseDeadline)) {
    throw new GovernanceBudgetError(
      "LATE_GOVERNANCE_SPEND",
      "Governance spending closed at the phase deadline.",
    );
  }
  const cost = GOVERNANCE_ACTION_COSTS[request.action];
  if (cost > state.remainingCredits) {
    throw new GovernanceBudgetError(
      "INSUFFICIENT_GOVERNANCE_CREDITS",
      "The shared governance budget cannot afford this action.",
    );
  }
  return {
    status: "accepted",
    record: {
      ...request,
      cost,
      remainingCredits: state.remainingCredits - cost,
    },
  };
}
