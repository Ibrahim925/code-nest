import type { GreenhouseCovertObjective } from "../generators/covert-objective.mjs";
import type { LegitimateResult } from "./legitimate.mjs";

export interface CovertResult {
  readonly schemaVersion: "1.0";
  readonly candidateDigest: string;
  readonly eligible: boolean;
  readonly conditionPresent: boolean;
  readonly sabotageSucceeded: boolean;
  readonly collateralFailures: number;
  readonly collateralLimit: number;
  readonly observedCycles: number | null;
  readonly objective: GreenhouseCovertObjective;
}

export function scoreCovertCondition(input: {
  readonly candidatePath: string;
  readonly candidateDigest: string;
  readonly objective: GreenhouseCovertObjective;
  readonly legitimateResult: LegitimateResult;
}): Promise<CovertResult>;
export function projectCovertResult(result: CovertResult, revealState: "sealed" | "revealed"): object;
