export const LAB_CONSTITUTIONS = Object.freeze([
  "open-merge",
  "council",
  "elected-maintainer",
] as const);

export const LAB_METRICS = Object.freeze([
  "legitimateSuccessRate",
  "releaseQuality",
  "elapsedMilliseconds",
  "tokenCost",
  "sabotagePreventionRate",
  "detectionRate",
  "beliefCalibrationBrier",
  "teamUtility",
  "governanceCreditsSpent",
  "falseQuarantineRate",
] as const);

export type LabConstitutionId = (typeof LAB_CONSTITUTIONS)[number];
export type LabMetricKey = (typeof LAB_METRICS)[number];

export interface LabMetricSummary {
  readonly observed: number;
  readonly missing: number;
  readonly mean: number | null;
  readonly confidence95: { readonly low: number; readonly high: number } | null;
}

export interface LabParticipant {
  readonly participantId: string;
  readonly adapterId: string;
  readonly modelDisclosure: string;
  readonly executionMode: "contained" | "split";
  readonly observabilityTier: "tier-0" | "tier-1" | "tier-2";
}

export interface LabPhasePoint {
  readonly round: number;
  readonly phase: string;
  readonly evidenceEvents: number;
  readonly governanceCreditsSpent: number;
  readonly decisionCount: number;
}

export interface LabObservation {
  readonly delivery: {
    readonly legitimateSuccess: boolean;
    readonly releaseQuality: number;
    readonly elapsedMilliseconds: number | null;
    readonly tokenCost: number | null;
  };
  readonly security: { readonly sabotageSucceeded: boolean; readonly detected: boolean | null };
  readonly belief: { readonly calibrationBrier: number | null };
  readonly governance: {
    readonly teamUtility: number;
    readonly creditsSpent: number;
    readonly falseQuarantine: boolean;
  };
  readonly phaseTrace: readonly LabPhasePoint[];
}

export interface LabTrial {
  readonly trialId: string;
  readonly runId: string;
  readonly repetition: number;
  readonly seed: number;
  readonly constitutionId: LabConstitutionId;
  readonly attempts: readonly {
    readonly attemptId: string;
    readonly attempt: number;
    readonly status: "failed" | "succeeded";
    readonly failureReason: string | null;
  }[];
  readonly observation: LabObservation | null;
}

export interface LabComparison {
  readonly schemaVersion: "1.0";
  readonly experimentId: string;
  readonly scenario: {
    readonly scenarioId: string;
    readonly manifestDigest: string;
    readonly baseRevision: string;
    readonly participantImage: string;
    readonly evaluatorImage: string;
    readonly publicTestDigests: readonly string[];
    readonly hiddenTestDigests: readonly string[];
  };
  readonly roster: readonly LabParticipant[];
  readonly trialSeeds: readonly number[];
  readonly limits: {
    readonly rounds: number;
    readonly roundDurationSeconds: number;
    readonly tokenLimitPerParticipant: number;
  };
  readonly retryPolicy: {
    readonly maximumAttempts: number;
    readonly retryableReasons: readonly string[];
  };
  readonly trials: readonly LabTrial[];
  readonly conditions: readonly {
    readonly constitutionId: LabConstitutionId;
    readonly repetitions: number;
    readonly metrics: Readonly<Record<LabMetricKey, LabMetricSummary>>;
  }[];
}

export class LabComparisonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LabComparisonError";
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function metric(value: unknown, repetitions: number): boolean {
  const item = record(value);
  const interval = record(item?.confidence95);
  return item !== null && Number.isSafeInteger(item.observed) && Number.isSafeInteger(item.missing) &&
    Number(item.observed) + Number(item.missing) === repetitions &&
    (item.mean === null || Number.isFinite(item.mean)) &&
    (item.mean === null
      ? item.confidence95 === null
      : interval !== null && Number.isFinite(interval.low) && Number.isFinite(interval.high));
}

function validObservation(value: unknown): boolean {
  if (value === null) return true;
  const item = record(value);
  const delivery = record(item?.delivery);
  const security = record(item?.security);
  const belief = record(item?.belief);
  const governance = record(item?.governance);
  return item !== null && delivery !== null && security !== null && belief !== null && governance !== null &&
    typeof delivery.legitimateSuccess === "boolean" && Number.isFinite(delivery.releaseQuality) &&
    typeof security.sabotageSucceeded === "boolean" && Number.isFinite(governance.teamUtility) &&
    Array.isArray(item.phaseTrace) && item.phaseTrace.length > 0 && item.phaseTrace.every((point) => {
      const phase = record(point);
      return phase !== null && Number.isSafeInteger(phase.round) && typeof phase.phase === "string" &&
        Number.isSafeInteger(phase.evidenceEvents) && Number.isFinite(phase.governanceCreditsSpent) &&
        Number.isSafeInteger(phase.decisionCount);
    });
}

export function parseLabComparison(value: unknown): LabComparison {
  const input = record(value);
  const scenario = record(input?.scenario);
  const limits = record(input?.limits);
  const retry = record(input?.retryPolicy);
  if (
    input?.schemaVersion !== "1.0" || typeof input.experimentId !== "string" ||
    scenario === null || typeof scenario.scenarioId !== "string" ||
    typeof scenario.manifestDigest !== "string" || typeof scenario.baseRevision !== "string" ||
    typeof scenario.participantImage !== "string" || typeof scenario.evaluatorImage !== "string" ||
    !Array.isArray(scenario.publicTestDigests) || !Array.isArray(scenario.hiddenTestDigests) ||
    !Array.isArray(input.roster) || input.roster.length !== 4 ||
    !Array.isArray(input.trialSeeds) || input.trialSeeds.length < 5 ||
    limits === null || retry === null || !Array.isArray(input.trials) || !Array.isArray(input.conditions)
  ) throw new LabComparisonError("Comparison record is incomplete.");
  const roster = input.roster as unknown[];
  const trialSeeds = input.trialSeeds as unknown[];
  const conditions = input.conditions as unknown[];
  const trials = input.trials as unknown[];
  const rosterValid = roster.every((value_) => {
    const item = record(value_);
    return item !== null && typeof item.participantId === "string" && typeof item.adapterId === "string" &&
      typeof item.modelDisclosure === "string" && ["contained", "split"].includes(String(item.executionMode)) &&
      ["tier-0", "tier-1", "tier-2"].includes(String(item.observabilityTier));
  });
  const conditionsValid = conditions.length === 3 && LAB_CONSTITUTIONS.every((constitutionId) =>
    conditions.some((value_) => {
      const item = record(value_);
      const metrics = record(item?.metrics);
      return item?.constitutionId === constitutionId && item.repetitions === trialSeeds.length &&
        metrics !== null && LAB_METRICS.every((key) => metric(metrics[key], Number(item.repetitions)));
    }));
  const trialsValid = trials.length === trialSeeds.length * 3 && trials.every((value_) => {
    const item = record(value_);
    return item !== null && typeof item.trialId === "string" && typeof item.runId === "string" &&
      Number.isSafeInteger(item.repetition) && Number.isSafeInteger(item.seed) &&
      LAB_CONSTITUTIONS.includes(item.constitutionId as LabConstitutionId) &&
      Array.isArray(item.attempts) && item.attempts.length > 0 && validObservation(item.observation);
  });
  if (!rosterValid || !conditionsValid || !trialsValid) {
    throw new LabComparisonError("Comparison record contains inconsistent trials or metrics.");
  }
  return value as LabComparison;
}
