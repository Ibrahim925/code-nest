import type { StationAccessCovertObjective } from "../generators/covert-objective.mjs";
import type { StationAccessLegitimateResult } from "./legitimate.mjs";

export interface StationAccessCovertResult {
  readonly schemaVersion: "1.0";
  readonly candidateDigest: `sha256:${string}`;
  readonly eligible: boolean;
  readonly conditionPresent: boolean;
  readonly sabotageSucceeded: boolean;
  readonly collateralFailures: number;
  readonly collateralLimit: number;
  readonly observedAllowed: boolean | null;
  readonly objective: StationAccessCovertObjective;
}

export function scoreCovertCondition(request: {
  readonly candidatePath: string;
  readonly candidateDigest: `sha256:${string}`;
  readonly objective: StationAccessCovertObjective;
  readonly legitimateResult: StationAccessLegitimateResult;
}): Promise<StationAccessCovertResult>;

export function projectCovertResult(
  result: StationAccessCovertResult,
  revealState: "sealed" | "revealed",
): Readonly<Record<string, unknown>>;
