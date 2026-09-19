import type { MatchPhaseTransition, TownHallTurn } from "@code-nest/core";

import type { BriefingReceipt, BriefingRequest } from "../../../briefing/domain/brief.js";
import type {
  CovertMatchResult,
  FrozenCandidate,
  LegitimateMatchResult,
  RevealedParticipantRole,
  RoundIntegrationResult,
  RoundWorkResult,
} from "../../domain/three-round-match.js";
import type { MatchScore } from "@code-nest/core";

export interface ThreeRoundRunLifecycle {
  create(runId: string, commandId: string): unknown;
}

export interface ThreeRoundBriefing {
  brief(request: BriefingRequest): Promise<BriefingReceipt>;
}

export interface RoundWorkRequest {
  readonly runId: string;
  readonly round: number;
  readonly scenarioId: string;
  readonly repositoryPath: string;
  readonly baseRevision: string;
  readonly participants: readonly {
    readonly participantId: string;
    readonly assignmentId: string;
  }[];
}

export interface RoundExecutor {
  runWork(request: RoundWorkRequest): Promise<RoundWorkResult>;
  runTownHall(roundId: string, recorder: RoundTownHallRecorder): Promise<void>;
  integrate(roundId: string): Promise<RoundIntegrationResult>;
}

export interface RoundTownHallRecorder {
  record(fact: Extract<
    MatchResolutionFact,
    { readonly type: "town_hall_started" | "town_hall_turn_recorded" }
  >): Promise<void>;
}

export interface CandidateFreezer {
  freeze(request: {
    readonly candidatePath: string;
    readonly candidateRevision: string;
  }): Promise<FrozenCandidate>;
}

export interface FinalMatchScorer {
  scoreLegitimate(candidate: FrozenCandidate): Promise<LegitimateMatchResult>;
  scoreCovert(
    candidate: FrozenCandidate,
    legitimate: LegitimateMatchResult,
    objectiveSeed: number,
  ): Promise<CovertMatchResult>;
}

export type MatchResolutionFact =
  | { readonly type: "phase_advanced"; readonly transition: MatchPhaseTransition }
  | { readonly type: "round_work_completed"; readonly work: RoundWorkResult }
  | {
      readonly type: "town_hall_started";
      readonly round: number;
      readonly speakingOrder: readonly string[];
    }
  | {
      readonly type: "town_hall_turn_recorded";
      readonly round: number;
      readonly turn: TownHallTurn;
    }
  | { readonly type: "round_integrated"; readonly integration: RoundIntegrationResult }
  | { readonly type: "candidate_frozen"; readonly candidate: FrozenCandidate }
  | { readonly type: "legitimate_scored"; readonly result: LegitimateMatchResult }
  | { readonly type: "roles_revealed"; readonly roles: readonly RevealedParticipantRole[] }
  | { readonly type: "covert_scored"; readonly result: CovertMatchResult }
  | { readonly type: "scoreboard_published"; readonly score: MatchScore }
  | { readonly type: "match_completed"; readonly candidateDigest: `sha256:${string}` };

export interface MatchResolutionJournal {
  record(runId: string, fact: MatchResolutionFact): Promise<void>;
}
