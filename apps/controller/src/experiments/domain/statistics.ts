export interface MetricSummary {
  readonly observed: number;
  readonly missing: number;
  readonly mean: number | null;
  readonly confidence95: { readonly low: number; readonly high: number } | null;
}

export type MetricIntervalKind = "mean" | "proportion" | "unit-mean";

const T_CRITICAL_95 = Object.freeze([
  12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228,
  2.201, 2.179, 2.16, 2.145, 2.131, 2.12, 2.11, 2.101, 2.093, 2.086,
  2.08, 2.074, 2.069, 2.064, 2.06, 2.056, 2.052, 2.048, 2.045, 2.042,
]);

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function wilson(mean: number, count: number): { low: number; high: number } {
  const z = 1.96;
  const denominator = 1 + z ** 2 / count;
  const center = (mean + z ** 2 / (2 * count)) / denominator;
  const margin = z * Math.sqrt(mean * (1 - mean) / count + z ** 2 / (4 * count ** 2)) /
    denominator;
  return { low: Math.max(0, center - margin), high: Math.min(1, center + margin) };
}

function student(
  values: readonly number[],
  mean: number,
  boundedUnit: boolean,
): { low: number; high: number } {
  if (values.length === 1) return { low: mean, high: mean };
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
    (values.length - 1);
  const degrees = values.length - 1;
  const critical = degrees <= T_CRITICAL_95.length ? T_CRITICAL_95[degrees - 1] ?? 1.96 : 1.96;
  const margin = critical * Math.sqrt(variance / values.length);
  const clamp = (value: number) => boundedUnit ? Math.min(1, Math.max(0, value)) : value;
  return { low: clamp(mean - margin), high: clamp(mean + margin) };
}

export function summarizeMetric(
  values: readonly (number | null)[],
  kind: MetricIntervalKind,
): MetricSummary {
  const observed = values.filter((value): value is number => value !== null);
  if (observed.length === 0) {
    return Object.freeze({ observed: 0, missing: values.length, mean: null, confidence95: null });
  }
  const mean = observed.reduce((sum, value) => sum + value, 0) / observed.length;
  const interval = kind === "proportion"
    ? wilson(mean, observed.length)
    : student(observed, mean, kind === "unit-mean");
  return Object.freeze({
    observed: observed.length,
    missing: values.length - observed.length,
    mean: round(mean),
    confidence95: Object.freeze({ low: round(interval.low), high: round(interval.high) }),
  });
}
