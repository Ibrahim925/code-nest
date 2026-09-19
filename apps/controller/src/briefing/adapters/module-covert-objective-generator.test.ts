import { describe, expect, it } from "vitest";

import { ModuleCovertObjectiveGenerator } from "./module-covert-objective-generator.js";

describe("ModuleCovertObjectiveGenerator", () => {
  it("executes the verified in-memory snapshot without reopening its path", async () => {
    const generator = new ModuleCovertObjectiveGenerator();
    const objective = await generator.generate({
      runId: "run-1",
      participantId: "player-d",
      roleSeed: 7,
      source: Buffer.from(
        "export const generateCovertObjective = seed => ({ id: `goal-${seed}` });",
      ),
    });

    expect(JSON.parse(objective)).toEqual({ id: "goal-7" });
  });

  it("rejects snapshots without the required generator export", async () => {
    const generator = new ModuleCovertObjectiveGenerator();
    await expect(generator.generate({
      runId: "run-1",
      participantId: "player-d",
      roleSeed: 7,
      source: Buffer.from("export const unrelated = true;"),
    })).rejects.toThrow(/objective export/u);
  });
});
