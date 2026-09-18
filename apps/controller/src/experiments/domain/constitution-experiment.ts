export const EXPERIMENT_SCHEMA_VERSION = "1.0" as const;
export const CONSTITUTION_IDS = Object.freeze([
  "open-merge",
  "council",
  "elected-maintainer",
] as const);

export type ConstitutionId = (typeof CONSTITUTION_IDS)[number];
export type ExecutionMode = "contained" | "split";
export type ObservabilityTier = "tier-0" | "tier-1" | "tier-2";
export type RetryReason =
  | "container_exit"
  | "controller_fault"
  | "model_timeout"
  | "out_of_memory"
  | "policy_violation";

export interface ExperimentScenario {
  readonly scenarioId: string;
  readonly manifestDigest: `sha256:${string}`;
  readonly baseRevision: string;
  readonly participantImage: string;
  readonly evaluatorImage: string;
  readonly publicTestDigests: readonly `sha256:${string}`[];
  readonly hiddenTestDigests: readonly `sha256:${string}`[];
}

export interface ExperimentParticipant {
  readonly participantId: string;
  readonly adapterId: string;
  readonly modelDisclosure: string;
  readonly executionMode: ExecutionMode;
  readonly observabilityTier: ObservabilityTier;
}

export interface ExperimentLimits {
  readonly rounds: number;
  readonly roundDurationSeconds: number;
  readonly tokenLimitPerParticipant: number;
}

export interface ExperimentRetryPolicy {
  readonly maximumAttempts: number;
  readonly retryableReasons: readonly RetryReason[];
}

export interface ConstitutionExperimentRequest {
  readonly schemaVersion: typeof EXPERIMENT_SCHEMA_VERSION;
  readonly experimentId: string;
  readonly scenario: ExperimentScenario;
  readonly roster: readonly ExperimentParticipant[];
  readonly trialSeeds: readonly number[];
  readonly limits: ExperimentLimits;
  readonly retryPolicy: ExperimentRetryPolicy;
}

export interface PlannedConstitutionTrial {
  readonly trialId: string;
  readonly runId: string;
  readonly repetition: number;
  readonly seed: number;
  readonly constitutionId: ConstitutionId;
}

export interface ConstitutionExperimentPlan {
  readonly schemaVersion: typeof EXPERIMENT_SCHEMA_VERSION;
  readonly experimentId: string;
  readonly scenario: ExperimentScenario;
  readonly roster: readonly ExperimentParticipant[];
  readonly trialSeeds: readonly number[];
  readonly limits: ExperimentLimits;
  readonly retryPolicy: ExperimentRetryPolicy;
  readonly trials: readonly PlannedConstitutionTrial[];
}

export class ConstitutionExperimentError extends Error {
  constructor(
    readonly code: "INVALID_EXPERIMENT_REQUEST" | "INVALID_TRIAL_OBSERVATION",
    message: string,
  ) {
    super(message);
    this.name = "ConstitutionExperimentError";
  }
}

const IDENTIFIER = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const REVISION = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const IMAGE = /^[^\s@]+@sha256:[a-f0-9]{64}$/;
const RETRY_REASONS = new Set<RetryReason>([
  "container_exit", "controller_fault", "model_timeout", "out_of_memory", "policy_violation",
]);

function invalid(message: string): never {
  throw new ConstitutionExperimentError("INVALID_EXPERIMENT_REQUEST", message);
}

function validDigests(values: readonly string[]): boolean {
  return values.length > 0 && values.every((value) => DIGEST.test(value));
}

function copyScenario(scenario: ExperimentScenario): ExperimentScenario {
  return Object.freeze({
    ...scenario,
    publicTestDigests: Object.freeze([...scenario.publicTestDigests]),
    hiddenTestDigests: Object.freeze([...scenario.hiddenTestDigests]),
  });
}

function validateScenario(scenario: ExperimentScenario): void {
  if (
    !IDENTIFIER.test(scenario.scenarioId) ||
    !DIGEST.test(scenario.manifestDigest) ||
    !REVISION.test(scenario.baseRevision) ||
    !IMAGE.test(scenario.participantImage) ||
    !IMAGE.test(scenario.evaluatorImage) ||
    !validDigests(scenario.publicTestDigests) ||
    !validDigests(scenario.hiddenTestDigests)
  ) invalid("Experiment scenario pins are incomplete or invalid.");
}

function validateRoster(roster: readonly ExperimentParticipant[]): void {
  const participantIds = new Set<string>();
  if (roster.length !== 4) invalid("Experiments require exactly four participants.");
  for (const participant of roster) {
    if (
      !IDENTIFIER.test(participant.participantId) ||
      !IDENTIFIER.test(participant.adapterId) ||
      participant.modelDisclosure.trim().length === 0 ||
      !["contained", "split"].includes(participant.executionMode) ||
      !["tier-0", "tier-1", "tier-2"].includes(participant.observabilityTier) ||
      participantIds.has(participant.participantId)
    ) invalid("Experiment roster entries must be complete and uniquely identified.");
    participantIds.add(participant.participantId);
  }
}

function validateSchedule(request: ConstitutionExperimentRequest): void {
  if (
    request.trialSeeds.length < 5 ||
    new Set(request.trialSeeds).size !== request.trialSeeds.length ||
    request.trialSeeds.some((seed) => !Number.isSafeInteger(seed) || seed < 0) ||
    !Number.isSafeInteger(request.limits.rounds) || request.limits.rounds < 1 ||
    request.limits.rounds > 3 ||
    !Number.isSafeInteger(request.limits.roundDurationSeconds) ||
    request.limits.roundDurationSeconds < 1 || request.limits.roundDurationSeconds > 3_600 ||
    !Number.isSafeInteger(request.limits.tokenLimitPerParticipant) ||
    request.limits.tokenLimitPerParticipant < 1 ||
    !Number.isSafeInteger(request.retryPolicy.maximumAttempts) ||
    request.retryPolicy.maximumAttempts < 1 || request.retryPolicy.maximumAttempts > 3 ||
    new Set(request.retryPolicy.retryableReasons).size !== request.retryPolicy.retryableReasons.length ||
    request.retryPolicy.retryableReasons.some((reason) => !RETRY_REASONS.has(reason))
  ) invalid("Experiment seeds, limits, or retry policy are invalid.");
}

export function createConstitutionExperimentPlan(
  request: ConstitutionExperimentRequest,
): ConstitutionExperimentPlan {
  if (request.schemaVersion !== EXPERIMENT_SCHEMA_VERSION || !IDENTIFIER.test(request.experimentId)) {
    return invalid("Experiment identity or schema version is invalid.");
  }
  validateScenario(request.scenario);
  validateRoster(request.roster);
  validateSchedule(request);
  const trials = request.trialSeeds.flatMap((seed, repetitionIndex) =>
    CONSTITUTION_IDS.map((constitutionId) => {
      const trialId = `${request.experimentId}-${repetitionIndex + 1}-${constitutionId}`;
      return Object.freeze({
        trialId,
        runId: trialId,
        repetition: repetitionIndex + 1,
        seed,
        constitutionId,
      });
    }),
  );
  return Object.freeze({
    schemaVersion: EXPERIMENT_SCHEMA_VERSION,
    experimentId: request.experimentId,
    scenario: copyScenario(request.scenario),
    roster: Object.freeze(request.roster.map((participant) => Object.freeze({ ...participant }))),
    trialSeeds: Object.freeze([...request.trialSeeds]),
    limits: Object.freeze({ ...request.limits }),
    retryPolicy: Object.freeze({
      ...request.retryPolicy,
      retryableReasons: Object.freeze([...request.retryPolicy.retryableReasons]),
    }),
    trials: Object.freeze(trials),
  });
}
