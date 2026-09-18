import type { SanitizedText } from "../../observatory/domain/activity-feed.js";

export type TownHallPass = "evidence_accusation" | "defence_rebuttal";
export type CitationStatus = "valid" | "mismatched" | "missing";

export interface TownHallCitationView {
  readonly eventId: string;
  readonly claimedKind: string;
  readonly status: CitationStatus;
}

export interface TownHallTurnView {
  readonly turnId: string;
  readonly eventId: string;
  readonly participantId: string;
  readonly pass: TownHallPass;
  readonly message: SanitizedText | null;
  readonly citations: readonly TownHallCitationView[];
}

export interface PublishedVoteView {
  readonly voterId: string;
  readonly choice: "approve" | "reject" | "abstain";
  readonly submitted: boolean;
}

export interface GovernanceBallotView {
  readonly motionId: string;
  readonly proposerId: string;
  readonly motionKind: string;
  readonly motionSummary: string;
  readonly motionDetail: SanitizedText | null;
  readonly status: "open" | "passed" | "rejected";
  readonly eligibleVoterIds: readonly string[];
  readonly requiredApprovals: number;
  readonly votesSubmitted: number;
  readonly closesAt: string;
  readonly votes: readonly PublishedVoteView[];
  readonly authorizedEffect: string | null;
}

export interface GovernanceOutcomeView {
  readonly id: string;
  readonly eventId: string;
  readonly motionId: string | null;
  readonly kind: "effect_applied" | "credits_spent";
  readonly summary: string;
  readonly cost: number | null;
  readonly remainingCredits: number | null;
}

export interface TownHallViewState {
  readonly status: "inactive" | "active" | "completed";
  readonly round: number | null;
  readonly speakingOrder: readonly string[];
  readonly activePass: TownHallPass | null;
  readonly currentSpeakerId: string | null;
  readonly turns: readonly TownHallTurnView[];
  readonly ballots: readonly GovernanceBallotView[];
  readonly outcomes: readonly GovernanceOutcomeView[];
  readonly lastDeliverySequence: number;
}

export function createTownHallViewState(): TownHallViewState {
  return {
    status: "inactive",
    round: null,
    speakingOrder: [],
    activePass: null,
    currentSpeakerId: null,
    turns: [],
    ballots: [],
    outcomes: [],
    lastDeliverySequence: 0,
  };
}
