import type { MatchScore, ParticipantRole } from "@code-nest/core";

import type {
  OneRoundMatchRequest,
  ReplayableIntegrationOutcome,
} from "./one-round-match.js";

export const THREE_ROUND_MATCH_SCHEMA_VERSION = "1.0" as const;

export type ThreeRoundMatchRequest = OneRoundMatchRequest;

export interface FrozenCandidate {
  readonly candidatePath: string;
  readonly candidateRevision: string;
  readonly candidateDigest: `sha256:${string}`;
}

export interface RoundParticipantResult {
  readonly participantId: string;
  readonly proposalId: string;
  readonly candidateRevision: string;
  readonly commitSummary: string;
  readonly publicMessages: readonly string[];
}

export interface RoundWorkResult {
  readonly roundId: string;
  readonly round: number;
  readonly baseRevision: string;
  readonly participants: readonly RoundParticipantResult[];
}

export interface FinalGovernanceState {
  readonly initialCredits: number;
  readonly creditsSpent: number;
  readonly activeParticipantIds: readonly string[];
  readonly quarantinedParticipantIds: readonly string[];
}

export interface RoundIntegrationResult {
  readonly roundId: string;
  readonly round: number;
  readonly baseRevision: string;
  readonly candidatePath: string;
  readonly candidateRevision: string;
  readonly outcomes: readonly ReplayableIntegrationOutcome[];
  readonly governance: FinalGovernanceState;
}

export interface LegitimateMatchResult {
  readonly schemaVersion: "1.0";
  readonly candidateDigest: `sha256:${string}`;
  readonly completionPassed: boolean;
  readonly qualityScore: number;
  readonly passedChecks: number;
  readonly totalChecks: number;
  readonly assignmentScores: Readonly<Record<string, number>>;
}

export interface RevealedCovertObjective {
  readonly objectiveId: string;
  readonly description: string;
}

export interface CovertMatchResult {
  readonly schemaVersion: "1.0";
  readonly candidateDigest: `sha256:${string}`;
  readonly eligible: boolean;
  readonly conditionPresent: boolean;
  readonly sabotageSucceeded: boolean;
  readonly collateralFailures: number;
  readonly collateralLimit: number;
  readonly objective: RevealedCovertObjective;
}

export interface RevealedParticipantRole {
  readonly participantId: string;
  readonly assignmentId: string;
  readonly role: ParticipantRole;
}

export interface ThreeRoundMatchResult {
  readonly schemaVersion: typeof THREE_ROUND_MATCH_SCHEMA_VERSION;
  readonly runId: string;
  readonly rounds: readonly RoundIntegrationResult[];
  readonly candidate: FrozenCandidate;
  readonly roles: readonly RevealedParticipantRole[];
  readonly legitimate: LegitimateMatchResult;
  readonly covert: CovertMatchResult;
  readonly score: MatchScore;
}

export type ThreeRoundMatchErrorCode =
  | "CANDIDATE_FREEZE_REJECTED"
  | "ROUND_RESULT_REJECTED"
  | "SCORING_RESULT_REJECTED";

export class ThreeRoundMatchError extends Error {
  constructor(
    readonly code: ThreeRoundMatchErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "ThreeRoundMatchError";
  }
}
