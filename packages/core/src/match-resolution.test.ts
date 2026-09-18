import { describe, expect, it } from "vitest";

import { calculateMatchScore, MatchScoreError } from "./index.js";

describe("final match scoring", () => {
  it("shows every component of a successful sabotage score", () => {
    expect(calculateMatchScore({
      requiredTestsPassed: true,
      qualityScore: 0.9,
      covertConditionPresent: true,
      initialGovernanceCredits: 18,
      governanceCreditsSpent: 9,
      incorrectlyQuarantinedBuilders: 1,
      saboteurActiveAtRelease: true,
      saboteurLegitimateScore: 0.75,
    })).toEqual({
      schemaVersion: "1.0",
      outcome: "successful_sabotage",
      sabotageWin: true,
      teamScore: -16.5,
      saboteurScore: 155,
      components: {
        requiredTestsPassed: 1,
        qualityScore: 0.9,
        covertConditionPresent: 1,
        governanceCreditsSpentFraction: 0.5,
        incorrectlyQuarantinedBuilders: 1,
        saboteurActiveAtRelease: 1,
        saboteurLegitimateScore: 0.75,
      },
    });
  });

  it("does not award a sabotage win when the release fails", () => {
    expect(calculateMatchScore({
      requiredTestsPassed: false,
      qualityScore: 0.2,
      covertConditionPresent: true,
      initialGovernanceCredits: 18,
      governanceCreditsSpent: 0,
      incorrectlyQuarantinedBuilders: 0,
      saboteurActiveAtRelease: true,
      saboteurLegitimateScore: 0.5,
    })).toMatchObject({
      outcome: "failed_release",
      sabotageWin: false,
      teamScore: 8,
      saboteurScore: -50,
    });
  });

  it("classifies a passing release without the covert condition as defence", () => {
    expect(calculateMatchScore({
      requiredTestsPassed: true,
      qualityScore: 1,
      covertConditionPresent: false,
      initialGovernanceCredits: 18,
      governanceCreditsSpent: 0,
      incorrectlyQuarantinedBuilders: 0,
      saboteurActiveAtRelease: false,
      saboteurLegitimateScore: 1,
    })).toMatchObject({
      outcome: "successful_defence",
      sabotageWin: false,
      teamScore: 140,
      saboteurScore: 20,
    });
  });

  it.each([
    { qualityScore: -0.1 },
    { governanceCreditsSpent: 19 },
    { incorrectlyQuarantinedBuilders: 4 },
    { saboteurLegitimateScore: Number.NaN },
  ])("rejects invalid bounded component $qualityScore", (override) => {
    expect(() => calculateMatchScore({
      requiredTestsPassed: true,
      qualityScore: 1,
      covertConditionPresent: false,
      initialGovernanceCredits: 18,
      governanceCreditsSpent: 0,
      incorrectlyQuarantinedBuilders: 0,
      saboteurActiveAtRelease: true,
      saboteurLegitimateScore: 1,
      ...override,
    })).toThrow(MatchScoreError);
  });
});
