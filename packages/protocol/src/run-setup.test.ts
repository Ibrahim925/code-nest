import { describe, expect, it } from "vitest";

import { parseRunSetupConfiguration } from "./run-setup";

const digest = `sha256:${"a".repeat(64)}`;
const validConfiguration = {
  schemaVersion: "1.0",
  runId: "run-027",
  scenario: {
    id: "station-access",
    manifestDigest: digest,
    repositoryRevision: "b".repeat(40),
    participantImage: `code-nest/participant@${digest}`,
    evaluatorImage: `code-nest/evaluator@${digest}`,
  },
  adapters: ["a", "b", "c", "d"].map((id) => ({
    participantId: `player-${id}`,
    adapterId: "fake-scripted",
    executionMode: "split",
    modelDisclosure: "Deterministic fixture",
  })),
  seed: 27,
  limits: {
    rounds: 3,
    roundDurationSeconds: 900,
    trustedTestWallTimeSeconds: 120,
    cpuCores: 1,
    memoryMiB: 1_024,
    processLimit: 64,
    workspaceMiB: 2_048,
    temporaryStorageMiB: 256,
  },
  disclosurePolicy: "clean-until-reveal",
  constitution: "council",
} as const;

describe("run setup protocol", () => {
  it("accepts one complete reproducible setup without transforming it", () => {
    expect(parseRunSetupConfiguration(validConfiguration)).toEqual({
      ok: true,
      value: validConfiguration,
    });
  });

  it("rejects missing pins, unsafe limits, and undeclared fields", () => {
    const result = parseRunSetupConfiguration({
      ...validConfiguration,
      scenario: { ...validConfiguration.scenario, manifestDigest: "latest" },
      limits: { ...validConfiguration.limits, cpuCores: 8 },
      operatorToken: "must-not-cross-the-boundary",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "/scenario/manifestDigest" }),
        expect.objectContaining({ path: "/limits/cpuCores" }),
        expect.objectContaining({ path: "/operatorToken" }),
      ]),
    );
  });

  it("requires four distinct participant identities", () => {
    const result = parseRunSetupConfiguration({
      ...validConfiguration,
      adapters: validConfiguration.adapters.map((adapter) => ({
        ...adapter,
        participantId: "player-a",
      })),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.issues).toContainEqual({
      code: "unique_participant",
      message: "Participant identities must be unique.",
      path: "/adapters/1/participantId",
    });
  });
});
