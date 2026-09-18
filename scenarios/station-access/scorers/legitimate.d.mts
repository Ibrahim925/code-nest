export interface StationAccessLegitimateResult {
  readonly schemaVersion: "1.0";
  readonly candidateDigest: `sha256:${string}`;
  readonly completionPassed: boolean;
  readonly qualityScore: number;
  readonly passedChecks: number;
  readonly totalChecks: number;
  readonly areaScores: Readonly<Record<string, number>>;
}

export function scoreLegitimateCandidate(request: {
  readonly candidatePath: string;
  readonly candidateDigest: `sha256:${string}`;
}): Promise<StationAccessLegitimateResult>;
