import {
  LAB_CONSTITUTIONS,
  type LabComparison,
  type LabConstitutionId,
  type LabMetricKey,
  type LabMetricSummary,
  type LabTrial,
} from "../domain/comparison.js";

export const CONDITION_LABELS: Readonly<Record<LabConstitutionId, string>> = Object.freeze({
  "open-merge": "Open Merge",
  council: "Council",
  "elected-maintainer": "Elected Maintainer",
});

export const METRIC_LABELS: Readonly<Record<LabMetricKey, string>> = Object.freeze({
  legitimateSuccessRate: "Legitimate success",
  releaseQuality: "Release quality",
  elapsedMilliseconds: "Elapsed time",
  tokenCost: "Token cost",
  sabotagePreventionRate: "Sabotage prevented",
  detectionRate: "Correct detection",
  beliefCalibrationBrier: "Belief calibration (Brier)",
  teamUtility: "Team utility",
  governanceCreditsSpent: "Governance credits spent",
  falseQuarantineRate: "False quarantine",
});

const PERCENT_METRICS = new Set<LabMetricKey>([
  "legitimateSuccessRate", "releaseQuality", "sabotagePreventionRate",
  "detectionRate", "falseQuarantineRate",
]);

export function conditionMetric(
  comparison: LabComparison,
  constitutionId: LabConstitutionId,
  key: LabMetricKey,
): LabMetricSummary {
  const condition = comparison.conditions.find((item) => item.constitutionId === constitutionId);
  if (condition === undefined) throw new Error(`Missing ${constitutionId} condition.`);
  return condition.metrics[key];
}

export function formatMetric(key: LabMetricKey, value: number | null): string {
  if (value === null) return "Missing";
  if (PERCENT_METRICS.has(key)) return `${Math.round(value * 100)}%`;
  if (key === "elapsedMilliseconds") return `${(value / 1_000).toFixed(1)} s`;
  return Number.isInteger(value) ? String(value) : value.toFixed(3);
}

export function formatInterval(key: LabMetricKey, metric: LabMetricSummary): string {
  if (metric.confidence95 === null) return "95% interval missing";
  return `95% interval ${formatMetric(key, metric.confidence95.low)}–${formatMetric(key, metric.confidence95.high)}`;
}

export function matchedTrials(
  comparison: LabComparison,
  repetition: number,
): readonly LabTrial[] {
  return LAB_CONSTITUTIONS.map((constitutionId) => {
    const trial = comparison.trials.find((item) =>
      item.constitutionId === constitutionId && item.repetition === repetition);
    if (trial === undefined) throw new Error(`Missing repetition ${repetition} for ${constitutionId}.`);
    return trial;
  });
}
