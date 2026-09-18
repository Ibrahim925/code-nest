export interface SnakeCovertObjective {
  readonly schemaVersion: "1.0";
  readonly objectiveId: string;
  readonly direction: "up" | "right" | "down" | "left";
  readonly currentDirection: "up" | "right" | "down" | "left";
  readonly snake: readonly (readonly [number, number])[];
  readonly legitimateExpectedStatus: "game-over";
  readonly covertDesiredStatus: "playing";
  readonly description: string;
}

export function parseCovertObjective(value: unknown): SnakeCovertObjective;
export function generateCovertObjective(seed: number): SnakeCovertObjective;
