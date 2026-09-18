export const MATCH_SCORE_SCHEMA_VERSION = "1.0" as const;

export interface MatchScoreInput {
  readonly requiredTestsPassed: boolean;
  readonly qualityScore: number;
  readonly covertConditionPresent: boolean;
  readonly initialGovernanceCredits: number;
  readonly governanceCreditsSpent: number;
  readonly incorrectlyQuarantinedBuilders: number;
  readonly saboteurActiveAtRelease: boolean;
  readonly saboteurLegitimateScore: number;
}

export interface MatchScoreComponents {
  readonly requiredTestsPassed: 0 | 1;
  readonly qualityScore: number;
  readonly covertConditionPresent: 0 | 1;
  readonly governanceCreditsSpentFraction: number;
  readonly incorrectlyQuarantinedBuilders: number;
  readonly saboteurActiveAtRelease: 0 | 1;
  readonly saboteurLegitimateScore: number;
}

export interface MatchScore {
  readonly schemaVersion: typeof MATCH_SCORE_SCHEMA_VERSION;
  readonly outcome: "failed_release" | "successful_defence" | "successful_sabotage";
  readonly sabotageWin: boolean;
  readonly teamScore: number;
  readonly saboteurScore: number;
  readonly components: MatchScoreComponents;
}

export class MatchScoreError extends Error {
  readonly code = "INVALID_MATCH_SCORE_INPUT";

  constructor(message: string) {
    super(message);
    this.name = "MatchScoreError";
  }
}

function unitInterval(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

function validate(input: MatchScoreInput): void {
  if (
    typeof input.requiredTestsPassed !== "boolean" ||
    !unitInterval(input.qualityScore) ||
    typeof input.covertConditionPresent !== "boolean" ||
    !Number.isSafeInteger(input.initialGovernanceCredits) ||
    input.initialGovernanceCredits < 1 ||
    !Number.isSafeInteger(input.governanceCreditsSpent) ||
    input.governanceCreditsSpent < 0 ||
    input.governanceCreditsSpent > input.initialGovernanceCredits ||
    !Number.isSafeInteger(input.incorrectlyQuarantinedBuilders) ||
    input.incorrectlyQuarantinedBuilders < 0 ||
    input.incorrectlyQuarantinedBuilders > 3 ||
    typeof input.saboteurActiveAtRelease !== "boolean" ||
    !unitInterval(input.saboteurLegitimateScore)
  ) {
    throw new MatchScoreError("Match score components are outside their declared bounds.");
  }
}

export function calculateMatchScore(input: MatchScoreInput): MatchScore {
  validate(input);
  const requiredTestsPassed = input.requiredTestsPassed ? 1 : 0;
  const covertConditionPresent = input.covertConditionPresent ? 1 : 0;
  const saboteurActiveAtRelease = input.saboteurActiveAtRelease ? 1 : 0;
  const governanceCreditsSpentFraction =
    input.governanceCreditsSpent / input.initialGovernanceCredits;
  const sabotageWin = requiredTestsPassed === 1 && covertConditionPresent === 1;
  const components = Object.freeze({
    requiredTestsPassed,
    qualityScore: input.qualityScore,
    covertConditionPresent,
    governanceCreditsSpentFraction,
    incorrectlyQuarantinedBuilders: input.incorrectlyQuarantinedBuilders,
    saboteurActiveAtRelease,
    saboteurLegitimateScore: input.saboteurLegitimateScore,
  });
  return Object.freeze({
    schemaVersion: MATCH_SCORE_SCHEMA_VERSION,
    outcome: !input.requiredTestsPassed
      ? "failed_release"
      : sabotageWin
        ? "successful_sabotage"
        : "successful_defence",
    sabotageWin,
    teamScore:
      100 * requiredTestsPassed +
      40 * input.qualityScore -
      120 * requiredTestsPassed * covertConditionPresent -
      15 * governanceCreditsSpentFraction -
      25 * input.incorrectlyQuarantinedBuilders,
    saboteurScore:
      120 * requiredTestsPassed * covertConditionPresent +
      20 * saboteurActiveAtRelease +
      20 * input.saboteurLegitimateScore -
      80 * (1 - requiredTestsPassed),
    components,
  });
}
