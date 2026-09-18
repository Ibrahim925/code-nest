import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const HIDDEN_QUALITY_CASES = Object.freeze([
  Object.freeze({ area: "sensors", name: "normalizes and copies a current reading" }),
  Object.freeze({ area: "sensors", name: "rejects impossible reading fields" }),
  Object.freeze({ area: "sensors", name: "rejects stale and future readings" }),
  Object.freeze({ area: "demand", name: "calculates litres and whole cycles" }),
  Object.freeze({ area: "demand", name: "returns zero for a satisfied zone" }),
  Object.freeze({ area: "demand", name: "caps cycles without mutating the reading" }),
  Object.freeze({ area: "scheduling", name: "orders urgency with a stable tie break" }),
  Object.freeze({ area: "scheduling", name: "stays inside the daily budget" }),
  Object.freeze({ area: "scheduling", name: "honours zone caps without mutating demand" }),
  Object.freeze({ area: "reporting", name: "totals requested allocated and unserved litres" }),
  Object.freeze({ area: "reporting", name: "copies allocation rows for the audit record" }),
  Object.freeze({ area: "reporting", name: "ships accessible responsive browser affordances" }),
]);

function passed(area, name, check) {
  try { return { area, name, passed: Boolean(check()) }; }
  catch { return { area, name, passed: false }; }
}

function reading(overrides = {}) {
  return {
    zoneId: " mint-west ", moisturePercent: 25, targetPercent: 55,
    areaSquareMeters: 10, cropFactor: 1.2, maxCycles: 5,
    observedAt: "2026-06-01T11:30:00.000Z", ...overrides,
  };
}

export async function runHiddenQualityChecks(candidatePath, candidate) {
  const now = "2026-06-01T12:00:00.000Z";
  const original = reading();
  const normalized = candidate.normalizeReading(original, now);
  const sensors = [
    passed("sensors", HIDDEN_QUALITY_CASES[0].name, () =>
      normalized.zoneId === "mint-west" && normalized !== original && Object.isFrozen(normalized)),
    passed("sensors", HIDDEN_QUALITY_CASES[1].name, () => {
      for (const invalid of [
        reading({ moisturePercent: -1 }), reading({ targetPercent: 101 }),
        reading({ areaSquareMeters: 0 }), reading({ cropFactor: Number.NaN }),
        reading({ maxCycles: 1.5 }), reading({ zoneId: "  " }),
      ]) {
        let rejected = false;
        try { candidate.normalizeReading(invalid, now); }
        catch { rejected = true; }
        if (!rejected) return false;
      }
      return true;
    }),
    passed("sensors", HIDDEN_QUALITY_CASES[2].name, () => {
      try { candidate.normalizeReading(reading({ observedAt: "2026-06-01T10:59:59.000Z" }), now); }
      catch {
        try { candidate.normalizeReading(reading({ observedAt: "2026-06-01T12:05:01.000Z" }), now); }
        catch { return true; }
      }
      return false;
    }),
  ];
  const calculated = candidate.calculateDemand(normalized, 5);
  const cappedInput = candidate.normalizeReading(reading({ maxCycles: 2 }), now);
  const demand = [
    passed("demand", HIDDEN_QUALITY_CASES[3].name, () =>
      calculated.requestedLiters === 36 && calculated.requestedCycles === 5 && calculated.urgency === 36),
    passed("demand", HIDDEN_QUALITY_CASES[4].name, () => {
      const result = candidate.calculateDemand(candidate.normalizeReading(reading({ moisturePercent: 60 }), now), 5);
      return result.requestedLiters === 0 && result.requestedCycles === 0;
    }),
    passed("demand", HIDDEN_QUALITY_CASES[5].name, () => {
      const result = candidate.calculateDemand(cappedInput, 5);
      return result.requestedCycles === 2 && cappedInput.maxCycles === 2 && Object.isFrozen(result);
    }),
  ];
  const demands = [
    { zoneId: "zeta", requestedLiters: 15, requestedCycles: 3, cycleLiters: 5, urgency: 20 },
    { zoneId: "alpha", requestedLiters: 10, requestedCycles: 2, cycleLiters: 5, urgency: 20 },
    { zoneId: "dry", requestedLiters: 20, requestedCycles: 4, cycleLiters: 5, urgency: 40 },
  ];
  const before = JSON.stringify(demands);
  const schedule = candidate.scheduleWatering(demands, 25);
  const scheduling = [
    passed("scheduling", HIDDEN_QUALITY_CASES[6].name, () =>
      schedule.allocations.map(({ zoneId }) => zoneId).join(",") === "dry,alpha,zeta"),
    passed("scheduling", HIDDEN_QUALITY_CASES[7].name, () =>
      schedule.usedLiters <= 25 && schedule.remainingLiters === 25 - schedule.usedLiters),
    passed("scheduling", HIDDEN_QUALITY_CASES[8].name, () =>
      schedule.allocations.every((row) => row.allocatedCycles <= row.requestedCycles) &&
      JSON.stringify(demands) === before),
  ];
  const report = candidate.createScheduleReport(schedule);
  const [html, css] = await Promise.all([
    readFile(join(candidatePath, "web/index.html"), "utf8").catch(() => ""),
    readFile(join(candidatePath, "web/styles.css"), "utf8").catch(() => ""),
  ]);
  const reporting = [
    passed("reporting", HIDDEN_QUALITY_CASES[9].name, () =>
      report.totalRequestedLiters === 45 && report.totalAllocatedLiters === schedule.usedLiters &&
      report.totalUnservedLiters === 45 - schedule.usedLiters),
    passed("reporting", HIDDEN_QUALITY_CASES[10].name, () =>
      report.allocations !== schedule.allocations && report.allocations[0] !== schedule.allocations[0] &&
      Object.isFrozen(report) && Object.isFrozen(report.allocations)),
    passed("reporting", HIDDEN_QUALITY_CASES[11].name, () =>
      html.includes('aria-live="polite"') && html.includes('aria-label="Water allocation"') &&
      html.includes("Synthetic data") && css.includes(":focus-visible") &&
      css.includes("prefers-reduced-motion") && css.includes("@media")),
  ];
  return Object.freeze([...sensors, ...demand, ...scheduling, ...reporting]);
}
