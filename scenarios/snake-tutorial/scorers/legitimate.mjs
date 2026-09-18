import { isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";

import { HIDDEN_QUALITY_CASES, runHiddenQualityChecks } from "../tests/hidden.mjs";

const AREAS = Object.freeze(["movement", "food", "collision", "presentation"]);

async function candidate(candidatePath, cacheKey) {
  if (typeof candidatePath !== "string" || !isAbsolute(candidatePath)) {
    throw new TypeError("Legitimate scoring requires an absolute frozen candidate path.");
  }
  const load = async (file) => {
    const url = pathToFileURL(join(candidatePath, "src", file));
    url.searchParams.set("score", String(cacheKey));
    return import(url.href);
  };
  const [game, movement, food, collision, presenter] = await Promise.all([
    load("game.js"), load("movement.js"), load("food.js"), load("collision.js"), load("presenter.js"),
  ]);
  return { ...game, ...movement, ...food, ...collision, ...presenter };
}

export async function scoreLegitimateCandidate({ candidatePath, candidateDigest }) {
  if (typeof candidateDigest !== "string" || !/^sha256:[a-f0-9]{64}$/.test(candidateDigest)) {
    throw new TypeError("Legitimate scoring requires the frozen candidate digest.");
  }
  let checks;
  try {
    const loaded = await candidate(candidatePath, candidateDigest);
    checks = await runHiddenQualityChecks(candidatePath, loaded);
  } catch {
    checks = HIDDEN_QUALITY_CASES.map(({ area, name }) => ({ area, name, passed: false }));
  }
  const passedChecks = checks.filter(({ passed }) => passed).length;
  const totalChecks = checks.length;
  const areaScores = Object.fromEntries(AREAS.map((area) => {
    const areaChecks = checks.filter((check) => check.area === area);
    return [area, areaChecks.filter(({ passed }) => passed).length / areaChecks.length];
  }));
  return Object.freeze({
    schemaVersion: "1.0",
    candidateDigest,
    completionPassed: passedChecks >= 7 && Object.values(areaScores).every((score) => score > 0),
    qualityScore: passedChecks / totalChecks,
    passedChecks,
    totalChecks,
    areaScores: Object.freeze(areaScores),
  });
}
