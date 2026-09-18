export const GOVERNANCE_SCHEMA_VERSION = "1.0" as const;
export const MAX_APPEAL_STATEMENT_BYTES = 4_096;

export type ParticipantGovernanceStatus = "active" | "quarantined";
export type PatchGovernanceStatus =
  | "submitted"
  | "accepted"
  | "delayed"
  | "rejected"
  | "quarantined"
  | "integrated"
  | "reverted";

export interface GovernanceParticipant {
  readonly participantId: string;
  readonly status: ParticipantGovernanceStatus;
}

export interface GovernancePatch {
  readonly patchId: string;
  readonly authorId: string;
  readonly status: PatchGovernanceStatus;
}

export interface GovernanceOffice {
  readonly officeId: string;
  readonly holderId: string | null;
}

interface MotionBase {
  readonly motionId: string;
  readonly proposerId: string;
}

export type GovernanceMotion =
  | (MotionBase & { readonly kind: "fund_audit"; readonly subjectId: string })
  | (MotionBase & {
      readonly kind:
        | "accept_patch"
        | "delay_patch"
        | "reject_patch"
        | "quarantine_patch"
        | "revert_patch";
      readonly patchId: string;
    })
  | (MotionBase & {
      readonly kind: "quarantine_participant";
      readonly participantId: string;
    })
  | (MotionBase & {
      readonly kind: "appeal_participant_quarantine";
      readonly participantId: string;
      readonly sanctionMotionId: string;
      readonly statement: string;
    })
  | (MotionBase & {
      readonly kind: "replace_office_holder";
      readonly officeId: string;
      readonly candidateId: string;
    });

export type GovernanceMotionKind = GovernanceMotion["kind"];

export type MotionProposerRule =
  | { readonly kind: "active_participant" }
  | { readonly kind: "target_participant" }
  | { readonly kind: "office_holder"; readonly officeId: string };

export type MotionElectorateRule =
  | "active_participants"
  | "active_non_authors"
  | "active_except_target";

export type BallotThreshold =
  | { readonly kind: "approval_count"; readonly approvals: number }
  | { readonly kind: "simple_majority" };

export interface GovernanceMotionRule {
  readonly proposer: MotionProposerRule;
  readonly electorate: MotionElectorateRule;
  readonly threshold: BallotThreshold;
}

export interface GovernanceRules {
  readonly schemaVersion: typeof GOVERNANCE_SCHEMA_VERSION;
  readonly constitutionId: string;
  readonly motions: Readonly<Partial<Record<GovernanceMotionKind, GovernanceMotionRule>>>;
}

export type GovernanceVoteChoice = "approve" | "reject" | "abstain";

export interface SealedGovernanceVote {
  readonly voterId: string;
  readonly choice: GovernanceVoteChoice;
}

export interface OpenGovernanceBallot {
  readonly status: "open";
  readonly motion: GovernanceMotion;
  readonly eligibleVoterIds: readonly string[];
  readonly requiredApprovals: number;
  readonly closesAt: string;
  readonly sealedVotes: readonly SealedGovernanceVote[];
}

export interface PublishedGovernanceVote extends SealedGovernanceVote {
  readonly submitted: boolean;
}

export type GovernanceEffect =
  | { readonly kind: "audit_authorized"; readonly subjectId: string }
  | { readonly kind: "patch_status_changed"; readonly patchId: string; readonly status: PatchGovernanceStatus }
  | { readonly kind: "participant_status_changed"; readonly participantId: string; readonly status: ParticipantGovernanceStatus }
  | { readonly kind: "office_holder_changed"; readonly officeId: string; readonly holderId: string };

export interface ClosedGovernanceBallot {
  readonly status: "passed" | "rejected";
  readonly motion: GovernanceMotion;
  readonly eligibleVoterIds: readonly string[];
  readonly requiredApprovals: number;
  readonly closedAt: string;
  readonly votes: readonly PublishedGovernanceVote[];
  readonly effect: GovernanceEffect | null;
}

export interface GovernanceState {
  readonly schemaVersion: typeof GOVERNANCE_SCHEMA_VERSION;
  readonly round: number;
  readonly participants: readonly GovernanceParticipant[];
  readonly patches: readonly GovernancePatch[];
  readonly offices: readonly GovernanceOffice[];
  readonly openBallot: OpenGovernanceBallot | null;
  readonly closedBallots: readonly ClosedGovernanceBallot[];
}

export interface GovernanceStateInput {
  readonly round: number;
  readonly participantIds: readonly string[];
  readonly patches: readonly GovernancePatch[];
  readonly offices: readonly GovernanceOffice[];
}

export interface GovernanceVoteRequest {
  readonly ballotId: string;
  readonly voterId: string;
  readonly choice: GovernanceVoteChoice;
}

export interface GovernanceVoteReceipt {
  readonly status: "accepted" | "duplicate";
  readonly ballotId: string;
  readonly voterId: string;
}

export type PublicGovernanceBallot =
  | {
      readonly status: "open";
      readonly motion: GovernanceMotion;
      readonly eligibleVoterIds: readonly string[];
      readonly requiredApprovals: number;
      readonly closesAt: string;
      readonly votesSubmitted: number;
    }
  | ClosedGovernanceBallot;

export class GovernanceError extends Error {
  constructor(
    readonly code:
      | "BALLOT_NOT_READY"
      | "BALLOT_CLOSED"
      | "DUPLICATE_MOTION"
      | "GOVERNANCE_VOTE_CONFLICT"
      | "INVALID_GOVERNANCE"
      | "MOTION_NOT_ALLOWED"
      | "NO_OPEN_BALLOT"
      | "OPEN_BALLOT_EXISTS"
      | "UNAUTHORIZED_GOVERNANCE_ACTION",
    message: string,
  ) {
    super(message);
    this.name = "GovernanceError";
  }
}
