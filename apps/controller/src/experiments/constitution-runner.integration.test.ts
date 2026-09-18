import { describe, expect, it } from "vitest";

import { ConstitutionExperimentRunner } from "./application/constitution-experiment-runner.js";
import {
  ExperimentAttemptError,
  type ExperimentAttemptRequest,
  type ExperimentMatchRunner,
  type ExperimentProgressFact,
  type ExperimentRecorder,
} from "./application/ports/constitution-experiment.js";
import {
  createConstitutionExperimentPlan,
  type ConstitutionExperimentRequest,
} from "./domain/constitution-experiment.js";
import type { ExperimentObservation } from "./domain/experiment-metrics.js";

const digest = (character: string) => `sha256:${character.repeat(64)}` as const;
const image = (name: string, character: string) => `${name}@${digest(character)}`;

function request(overrides: Partial<ConstitutionExperimentRequest> = {}): ConstitutionExperimentRequest {
  return {
    schemaVersion: "1.0",
    experimentId: "station-constitution-study",
    scenario: {
      scenarioId: "station-access",
      manifestDigest: digest("a"),
      baseRevision: "b".repeat(40),
      participantImage: image("code-nest/participant", "c"),
      evaluatorImage: image("code-nest/evaluator", "d"),
      publicTestDigests: [digest("e")],
      hiddenTestDigests: [digest("f")],
    },
    roster: ["a", "b", "c", "d"].map((id, index) => ({
      participantId: `player-${id}`,
      adapterId: index % 2 === 0 ? "direct-reference" : "contract-fixture",
      modelDisclosure: index % 2 === 0 ? "Reference model" : "Deterministic fixture",
      executionMode: index % 2 === 0 ? "split" as const : "contained" as const,
      observabilityTier: index % 2 === 0 ? "tier-2" as const : "tier-1" as const,
    })),
    trialSeeds: [101, 202, 303, 404, 505],
    limits: { rounds: 3, roundDurationSeconds: 900, tokenLimitPerParticipant: 12_000 },
    retryPolicy: { maximumAttempts: 2, retryableReasons: ["container_exit"] },
    ...overrides,
  };
}

function observation(input: ExperimentAttemptRequest): ExperimentObservation {
  const conditionOffset = {
    "open-merge": 0,
    council: 0.12,
    "elected-maintainer": 0.07,
  }[input.constitutionId];
  return {
    delivery: {
      legitimateSuccess: input.repetition !== 5 || input.constitutionId !== "open-merge",
      releaseQuality: 0.7 + conditionOffset + input.repetition / 100,
      elapsedMilliseconds: 1_000 + input.repetition * 10,
      tokenCost: 800 + input.repetition,
    },
    security: {
      sabotageSucceeded: input.constitutionId === "open-merge" && input.repetition <= 3,
      detected: input.constitutionId === "open-merge" ? false : true,
    },
    belief: {
      calibrationBrier: input.constitutionId === "council" && input.repetition === 5
        ? null
        : 0.5 - conditionOffset,
    },
    governance: {
      teamUtility: 90 + conditionOffset * 100 - input.repetition,
      creditsSpent: input.constitutionId === "open-merge" ? 0 : 4 + input.repetition,
      falseQuarantine: input.constitutionId === "elected-maintainer" && input.repetition === 4,
    },
    phaseTrace: [
      {
        round: 1, phase: "evidence", evidenceEvents: input.repetition + 2,
        governanceCreditsSpent: 0, decisionCount: 0,
      },
      {
        round: 1, phase: "governance", evidenceEvents: input.repetition + 2,
        governanceCreditsSpent: input.constitutionId === "open-merge" ? 0 : 2,
        decisionCount: input.constitutionId === "open-merge" ? 0 : 1,
      },
    ],
  };
}

class RecordingMatchRunner implements ExperimentMatchRunner {
  readonly calls: ExperimentAttemptRequest[] = [];

  async run(input: ExperimentAttemptRequest): Promise<ExperimentObservation> {
    this.calls.push(input);
    if (input.constitutionId === "council" && input.repetition === 2 && input.attempt === 1) {
      throw new ExperimentAttemptError("container_exit", "Synthetic first-attempt exit.");
    }
    return observation(input);
  }
}

class MemoryRecorder implements ExperimentRecorder {
  readonly facts: ExperimentProgressFact[] = [];

  async record(_experimentId: string, fact: ExperimentProgressFact): Promise<void> {
    this.facts.push(fact);
  }
}

describe("repeated constitution experiment runner", () => {
  it("runs five matched trials under all three constitutions with explicit retries", async () => {
    const matches = new RecordingMatchRunner();
    const recorder = new MemoryRecorder();
    const result = await new ConstitutionExperimentRunner({ matches, recorder }).run(request());

    expect(result.trials).toHaveLength(15);
    expect(matches.calls).toHaveLength(16);
    expect(result.trials.slice(0, 3).map(({ seed }) => seed)).toEqual([101, 101, 101]);
    expect(result.trials.slice(0, 3).map(({ constitutionId }) => constitutionId)).toEqual([
      "open-merge", "council", "elected-maintainer",
    ]);
    expect(matches.calls.every((call) => call.scenario === result.scenario)).toBe(true);
    expect(matches.calls.every((call) => call.roster === result.roster)).toBe(true);
    const retried = result.trials.find((trial) =>
      trial.constitutionId === "council" && trial.repetition === 2);
    expect(retried?.attempts).toEqual([
      expect.objectContaining({ attempt: 1, status: "failed", failureReason: "container_exit" }),
      expect.objectContaining({ attempt: 2, status: "succeeded", failureReason: null }),
    ]);
    expect(new Set(retried?.attempts.map(({ attemptId }) => attemptId)).size).toBe(2);
    expect(recorder.facts.filter(({ type }) => type === "attempt_finished")).toHaveLength(16);
  });

  it("reports four metric families, uncertainty intervals, and missing observations", async () => {
    const result = await new ConstitutionExperimentRunner({
      matches: new RecordingMatchRunner(),
      recorder: new MemoryRecorder(),
    }).run(request());
    expect(result.conditions).toHaveLength(3);
    expect(result.conditions.every(({ repetitions }) => repetitions === 5)).toBe(true);
    const council = result.conditions.find(({ constitutionId }) => constitutionId === "council");
    expect(council?.metrics).toMatchObject({
      legitimateSuccessRate: { observed: 5, missing: 0, mean: 1 },
      sabotagePreventionRate: { observed: 5, missing: 0, mean: 1 },
      beliefCalibrationBrier: { observed: 4, missing: 1, mean: 0.38 },
      teamUtility: { observed: 5, missing: 0 },
    });
    expect(council?.metrics.releaseQuality.confidence95).toEqual(expect.objectContaining({
      low: expect.any(Number), high: expect.any(Number),
    }));
    expect(council?.metrics.releaseQuality.confidence95?.low)
      .toBeLessThan(council?.metrics.releaseQuality.confidence95?.high ?? 0);
    expect(council?.metrics.legitimateSuccessRate.confidence95?.low).toBeLessThan(1);
  });

  it("retains pins, disclosures, limits, tests, and retry policy in the result", async () => {
    const input = request();
    const recorder = new MemoryRecorder();
    const result = await new ConstitutionExperimentRunner({
      matches: new RecordingMatchRunner(), recorder,
    }).run(input);
    expect(result).toMatchObject({
      experimentId: input.experimentId,
      scenario: input.scenario,
      roster: input.roster,
      trialSeeds: input.trialSeeds,
      limits: input.limits,
      retryPolicy: input.retryPolicy,
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(recorder.facts.at(0)).toMatchObject({ type: "experiment_started" });
    expect(recorder.facts.at(-1)).toMatchObject({ type: "experiment_completed" });
  });

  it("reports exhausted trials as missing instead of inventing values", async () => {
    const matches: ExperimentMatchRunner = {
      run: async () => { throw new ExperimentAttemptError("policy_violation", "Synthetic denial."); },
    };
    const result = await new ConstitutionExperimentRunner({
      matches,
      recorder: new MemoryRecorder(),
    }).run(request({
      retryPolicy: { maximumAttempts: 2, retryableReasons: ["policy_violation"] },
    }));
    expect(result.trials.every(({ attempts, observation: value }) =>
      attempts.length === 2 && value === null)).toBe(true);
    expect(result.conditions.every(({ metrics }) =>
      metrics.releaseQuality.observed === 0 && metrics.releaseQuality.missing === 5)).toBe(true);
  });

  it("rejects fewer than five, repeated, or invalid seeds before any match starts", () => {
    for (const trialSeeds of [[1, 2, 3, 4], [1, 2, 3, 4, 4], [1, 2, 3, 4, -1]]) {
      expect(() => createConstitutionExperimentPlan(request({ trialSeeds })))
        .toThrow(/seeds, limits, or retry policy/);
    }
  });
});
