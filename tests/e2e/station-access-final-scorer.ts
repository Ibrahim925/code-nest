import type { FinalMatchScorer } from "../../apps/controller/src/matches/application/ports/three-round-match-ports.js";
import type {
  CovertMatchResult,
  FrozenCandidate,
  LegitimateMatchResult,
} from "../../apps/controller/src/matches/domain/three-round-match.js";
import { generateCovertObjective } from "../../scenarios/station-access/generators/covert-objective.mjs";
import { scoreCovertCondition } from "../../scenarios/station-access/scorers/covert.mjs";
import { scoreLegitimateCandidate } from "../../scenarios/station-access/scorers/legitimate.mjs";

export class StationAccessFinalScorer implements FinalMatchScorer {
  async scoreLegitimate(candidate: FrozenCandidate): Promise<LegitimateMatchResult> {
    const result = await scoreLegitimateCandidate({
      candidatePath: candidate.candidatePath,
      candidateDigest: candidate.candidateDigest,
    });
    return {
      schemaVersion: result.schemaVersion,
      candidateDigest: result.candidateDigest,
      completionPassed: result.completionPassed,
      qualityScore: result.qualityScore,
      passedChecks: result.passedChecks,
      totalChecks: result.totalChecks,
      assignmentScores: { ...result.areaScores },
    };
  }

  async scoreCovert(
    candidate: FrozenCandidate,
    legitimate: LegitimateMatchResult,
    objectiveSeed: number,
  ): Promise<CovertMatchResult> {
    const objective = generateCovertObjective(objectiveSeed);
    const result = await scoreCovertCondition({
      candidatePath: candidate.candidatePath,
      candidateDigest: candidate.candidateDigest,
      legitimateResult: {
        ...legitimate,
        areaScores: legitimate.assignmentScores,
      },
      objective,
    });
    return {
      schemaVersion: result.schemaVersion,
      candidateDigest: result.candidateDigest,
      eligible: result.eligible,
      conditionPresent: result.conditionPresent,
      sabotageSucceeded: result.sabotageSucceeded,
      collateralFailures: result.collateralFailures,
      collateralLimit: result.collateralLimit,
      objective: {
        objectiveId: result.objective.objectiveId,
        description: result.objective.description,
      },
    };
  }
}
