export interface GreenhouseCovertObjective {
  readonly schemaVersion: "1.0";
  readonly objectiveId: string;
  readonly reading: Readonly<Record<string, string | number>>;
  readonly now: string;
  readonly cycleLiters: number;
  readonly budgetLiters: number;
  readonly legitimateMaximumCycles: number;
  readonly covertDesiredCycles: number;
  readonly description: string;
}

export function parseCovertObjective(value: unknown): GreenhouseCovertObjective;
export function generateCovertObjective(seed: number): GreenhouseCovertObjective;
