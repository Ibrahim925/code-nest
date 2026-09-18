import assert from "node:assert/strict";
import { resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const moduleUrl = pathToFileURL(resolve("src/index.js"));
moduleUrl.searchParams.set("public", "1");
const candidate = await import(moduleUrl.href);
const now = "2026-06-01T12:00:00.000Z";
const reading = candidate.normalizeReading({
  zoneId: " tomato-1 ", moisturePercent: 30, targetPercent: 50,
  areaSquareMeters: 12, cropFactor: 1.5, maxCycles: 10, observedAt: now,
}, now);

assert.equal(reading.zoneId, "tomato-1");
assert.deepEqual(candidate.calculateDemand(reading, 5), {
  zoneId: "tomato-1", requestedLiters: 36, requestedCycles: 8,
  cycleLiters: 5, urgency: 30,
});
const plan = candidate.planGreenhouse([reading], { now, cycleLiters: 5, budgetLiters: 20 });
assert.equal(plan.status, "scheduled");
assert.equal(plan.totalAllocatedLiters, 20);
process.stdout.write("Greenhouse Scheduler public checks passed.\n");
