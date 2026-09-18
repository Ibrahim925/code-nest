import {
  LAB_CONSTITUTIONS,
  LAB_METRICS,
  type LabComparison,
  type LabConstitutionId,
  type LabMetricKey,
  type LabMetricSummary,
  type LabObservation,
} from "./domain/comparison.js";

const digest = (character: string) => `sha256:${character.repeat(64)}`;

const MEANS: Readonly<Record<LabMetricKey, number>> = Object.freeze({
  legitimateSuccessRate: 0.8,
  releaseQuality: 0.84,
  elapsedMilliseconds: 83_000,
  tokenCost: 9_200,
  sabotagePreventionRate: 0.6,
  detectionRate: 0.65,
  beliefCalibrationBrier: 0.38,
  teamUtility: 112,
  governanceCreditsSpent: 5,
  falseQuarantineRate: 0.2,
});

function metric(key: LabMetricKey, offset: number, missing: number): LabMetricSummary {
  const mean = MEANS[key] + offset;
  const scale = mean > 1 ? Math.max(1, mean * 0.05) : 0.08;
  return {
    observed: 5 - missing,
    missing,
    mean,
    confidence95: { low: Math.max(0, mean - scale), high: mean + scale },
  };
}

function observation(
  constitutionId: LabConstitutionId,
  repetition: number,
): LabObservation | null {
  if (constitutionId === "open-merge" && repetition === 5) return null;
  const governed = constitutionId !== "open-merge";
  return {
    delivery: {
      legitimateSuccess: true,
      releaseQuality: constitutionId === "council" ? 0.9 : 0.8,
      elapsedMilliseconds: 80_000 + repetition * 1_000,
      tokenCost: 9_000 + repetition * 10,
    },
    security: {
      sabotageSucceeded: constitutionId === "open-merge" && repetition < 4,
      detected: governed,
    },
    belief: { calibrationBrier: governed ? 0.31 : 0.55 },
    governance: {
      teamUtility: governed ? 118 : 101,
      creditsSpent: governed ? 5 : 0,
      falseQuarantine: constitutionId === "elected-maintainer" && repetition === 4,
    },
    phaseTrace: [
      { round: 1, phase: "work", evidenceEvents: 2 + repetition, governanceCreditsSpent: 0, decisionCount: 0 },
      { round: 1, phase: "evidence", evidenceEvents: 4 + repetition, governanceCreditsSpent: 0, decisionCount: 0 },
      { round: 1, phase: "governance", evidenceEvents: 4 + repetition,
        governanceCreditsSpent: governed ? 2 : 0, decisionCount: governed ? 1 : 0 },
    ],
  };
}

export function comparisonFixture(): LabComparison {
  const trialSeeds = [101, 202, 303, 404, 505];
  return {
    schemaVersion: "1.0",
    experimentId: "synthetic-constitution-study",
    scenario: {
      scenarioId: "station-access",
      manifestDigest: digest("a"),
      baseRevision: "b".repeat(40),
      participantImage: `code-nest/participant@${digest("c")}`,
      evaluatorImage: `code-nest/evaluator@${digest("d")}`,
      publicTestDigests: [digest("e")],
      hiddenTestDigests: [digest("f")],
    },
    roster: [
      { participantId: "player-a", adapterId: "direct-reference", modelDisclosure: "Reference model A", executionMode: "split", observabilityTier: "tier-2" },
      { participantId: "player-b", adapterId: "contract-fixture", modelDisclosure: "Fixture model B", executionMode: "contained", observabilityTier: "tier-1" },
      { participantId: "player-c", adapterId: "direct-reference", modelDisclosure: "Reference model C", executionMode: "split", observabilityTier: "tier-2" },
      { participantId: "player-d", adapterId: "contract-fixture", modelDisclosure: "Fixture model D", executionMode: "contained", observabilityTier: "tier-1" },
    ],
    trialSeeds,
    limits: { rounds: 3, roundDurationSeconds: 900, tokenLimitPerParticipant: 12_000 },
    retryPolicy: { maximumAttempts: 2, retryableReasons: ["container_exit"] },
    conditions: LAB_CONSTITUTIONS.map((constitutionId, index) => ({
      constitutionId,
      repetitions: 5,
      metrics: Object.fromEntries(LAB_METRICS.map((key) => [
        key,
        metric(key, index * 0.02, constitutionId === "open-merge" ? 1 : 0),
      ])) as unknown as Readonly<Record<LabMetricKey, LabMetricSummary>>,
    })),
    trials: trialSeeds.flatMap((seed, index) => LAB_CONSTITUTIONS.map((constitutionId) => ({
      trialId: `trial-${index + 1}-${constitutionId}`,
      runId: `run-${index + 1}-${constitutionId}`,
      repetition: index + 1,
      seed,
      constitutionId,
      attempts: constitutionId === "council" && index === 1
        ? [
            { attemptId: `attempt-${index + 1}-1`, attempt: 1, status: "failed" as const, failureReason: "container_exit" },
            { attemptId: `attempt-${index + 1}-2`, attempt: 2, status: "succeeded" as const, failureReason: null },
          ]
        : [{ attemptId: `attempt-${index + 1}`, attempt: 1, status: "succeeded" as const, failureReason: null }],
      observation: observation(constitutionId, index + 1),
    }))),
  };
}
