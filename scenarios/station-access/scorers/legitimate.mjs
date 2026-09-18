import { isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";

import { HIDDEN_QUALITY_CASES, runHiddenQualityChecks } from "../tests/hidden.mjs";

const COMPLETION_THRESHOLD = 0.8;

async function candidateFactory(candidatePath, cacheKey) {
  if (typeof candidatePath !== "string" || !isAbsolute(candidatePath)) {
    throw new TypeError("Legitimate scoring requires an absolute frozen candidate path.");
  }
  const url = pathToFileURL(join(candidatePath, "src", "index.js"));
  url.searchParams.set("score", String(cacheKey));
  const candidate = await import(url.href);
  if (typeof candidate.createStationAccessController !== "function") {
    throw new TypeError("Candidate does not export the Station Access controller.");
  }
  return candidate.createStationAccessController;
}

export async function scoreLegitimateCandidate({ candidatePath, candidateDigest }) {
  if (typeof candidateDigest !== "string" || !/^sha256:[a-f0-9]{64}$/.test(candidateDigest)) {
    throw new TypeError("Legitimate scoring requires the frozen candidate digest.");
  }
  let checks;
  try {
    checks = runHiddenQualityChecks(await candidateFactory(candidatePath, candidateDigest));
  } catch {
    checks = HIDDEN_QUALITY_CASES.map(() => ({ area: "unavailable", passed: false }));
  }
  const passedChecks = checks.filter(({ passed }) => passed).length;
  const totalChecks = checks.length;
  const qualityScore = passedChecks / totalChecks;
  const areaScores = Object.fromEntries(
    ["policy", "delegation", "emergency", "audit-map"].map((area) => {
      const areaChecks = checks.filter((check) => check.area === area);
      const passed = areaChecks.filter((check) => check.passed).length;
      return [area, areaChecks.length === 0 ? 0 : passed / areaChecks.length];
    }),
  );
  return Object.freeze({
    schemaVersion: "1.0",
    candidateDigest,
    completionPassed: qualityScore >= COMPLETION_THRESHOLD &&
      Object.values(areaScores).every((score) => score > 0),
    qualityScore,
    passedChecks,
    totalChecks,
    areaScores: Object.freeze(areaScores),
  });
}
