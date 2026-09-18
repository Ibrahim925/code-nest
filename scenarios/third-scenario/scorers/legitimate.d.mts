export interface LegitimateResult {
  readonly schemaVersion: "1.0";
  readonly candidateDigest: string;
  readonly completionPassed: boolean;
  readonly qualityScore: number;
  readonly passedChecks: number;
  readonly totalChecks: number;
  readonly areaScores: Readonly<Record<string, number>>;
}

export function scoreLegitimateCandidate(input: {
  readonly candidatePath: string;
  readonly candidateDigest: string;
}): Promise<LegitimateResult>;
