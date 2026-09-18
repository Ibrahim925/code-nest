export const BELIEF_REPORT_SCHEMA_VERSION = "1.0" as const;

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const MAX_ACTIVE_PARTICIPANTS = 64;

export class BeliefReportError extends Error {
  constructor(
    readonly code: "INVALID_BELIEF_REPORT",
    message: string,
  ) {
    super(message);
    this.name = "BeliefReportError";
  }
}

export interface SuspicionAllocation {
  readonly participantId: string;
  readonly points: number;
}

export interface BeliefReportSubmission {
  readonly participantId: string;
  readonly round: number;
  readonly allocations: readonly SuspicionAllocation[];
  readonly strongestEvidenceEventId: string;
}

export interface PrivateBeliefReport extends BeliefReportSubmission {
  readonly schemaVersion: typeof BELIEF_REPORT_SCHEMA_VERSION;
}

function invalid(message: string): never {
  throw new BeliefReportError("INVALID_BELIEF_REPORT", message);
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return invalid("Belief report must be an object.");
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    return invalid("Belief report contains unexpected or missing fields.");
  }
}

function identifier(value: unknown, field: string): string {
  if (typeof value !== "string" || !IDENTIFIER_PATTERN.test(value)) {
    return invalid(`Belief ${field} must be a portable identifier.`);
  }
  return value;
}

function round(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    return invalid("Belief round must be a positive safe integer.");
  }
  return value;
}

function compareIdentifiers(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function allocations(value: unknown, reporterId: string): SuspicionAllocation[] {
  if (!Array.isArray(value) || value.length === 0 || value.length >= MAX_ACTIVE_PARTICIPANTS) {
    return invalid("Belief allocations must contain one to 63 targets.");
  }
  const seen = new Set<string>();
  const parsed = value.map((item) => {
    const allocation = record(item);
    exactKeys(allocation, ["participantId", "points"]);
    const participantId = identifier(allocation.participantId, "target participant");
    if (
      participantId === reporterId || seen.has(participantId) ||
      typeof allocation.points !== "number" ||
      !Number.isSafeInteger(allocation.points) || allocation.points < 0 || allocation.points > 100
    ) {
      return invalid("Belief allocations require unique other participants and integer points from 0 to 100.");
    }
    seen.add(participantId);
    return { participantId, points: allocation.points };
  });
  if (parsed.reduce((sum, item) => sum + item.points, 0) !== 100) {
    return invalid("Belief suspicion points must total exactly 100.");
  }
  return parsed.sort((left, right) =>
    compareIdentifiers(left.participantId, right.participantId)
  );
}

export function parsePrivateBeliefReport(input: unknown): PrivateBeliefReport {
  const value = record(input);
  exactKeys(value, [
    "schemaVersion", "participantId", "round", "allocations", "strongestEvidenceEventId",
  ]);
  if (value.schemaVersion !== BELIEF_REPORT_SCHEMA_VERSION) {
    return invalid("Belief report schema version is unsupported.");
  }
  const participantId = identifier(value.participantId, "reporting participant");
  return {
    schemaVersion: BELIEF_REPORT_SCHEMA_VERSION,
    participantId,
    round: round(value.round),
    allocations: allocations(value.allocations, participantId),
    strongestEvidenceEventId: identifier(value.strongestEvidenceEventId, "evidence event ID"),
  };
}

export function createPrivateBeliefReport(
  activeParticipantIds: readonly string[],
  submission: BeliefReportSubmission,
): PrivateBeliefReport {
  if (
    activeParticipantIds.length < 2 || activeParticipantIds.length > MAX_ACTIVE_PARTICIPANTS ||
    activeParticipantIds.some((participantId) => !IDENTIFIER_PATTERN.test(participantId)) ||
    new Set(activeParticipantIds).size !== activeParticipantIds.length ||
    !activeParticipantIds.includes(submission.participantId)
  ) {
    return invalid("Belief report requires a valid active-participant roster containing the reporter.");
  }
  const report = parsePrivateBeliefReport({
    schemaVersion: BELIEF_REPORT_SCHEMA_VERSION,
    ...submission,
  });
  const expectedTargets = activeParticipantIds
    .filter((participantId) => participantId !== report.participantId)
    .sort();
  if (
    report.allocations.length !== expectedTargets.length ||
    report.allocations.some(({ participantId }, index) => participantId !== expectedTargets[index])
  ) {
    return invalid("Belief report must allocate points across every other active participant exactly once.");
  }
  return report;
}

export function sameBeliefSubmission(
  report: PrivateBeliefReport,
  submission: BeliefReportSubmission,
): boolean {
  try {
    const candidate = parsePrivateBeliefReport({
      schemaVersion: BELIEF_REPORT_SCHEMA_VERSION,
      ...submission,
    });
    return JSON.stringify(candidate) === JSON.stringify(report);
  } catch (error: unknown) {
    if (error instanceof BeliefReportError) return false;
    throw error;
  }
}
