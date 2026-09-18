import {
  GovernanceError,
  type ClosedGovernanceBallot,
  type GovernanceEffect,
  type GovernanceMotion,
  type GovernanceState,
  type OpenGovernanceBallot,
  type PublicGovernanceBallot,
} from "./governance-types.js";

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export interface GovernanceCloseResult {
  readonly status: "accepted" | "duplicate";
  readonly state: GovernanceState;
  readonly ballot: ClosedGovernanceBallot;
}

function fail(code: GovernanceError["code"], message: string): never {
  throw new GovernanceError(code, message);
}

function identifier(value: unknown): void {
  if (typeof value !== "string" || !IDENTIFIER_PATTERN.test(value)) {
    return fail("INVALID_GOVERNANCE", "Governance ballot ID must be portable.");
  }
}

function time(value: string): number {
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    return fail("INVALID_GOVERNANCE", "Governance ballot timestamp is invalid.");
  }
  return milliseconds;
}

function nowMilliseconds(now: Date): number {
  const value = now.getTime();
  if (!Number.isFinite(value)) return fail("INVALID_GOVERNANCE", "Governance time is invalid.");
  return value;
}

function effectFor(motion: GovernanceMotion): GovernanceEffect {
  switch (motion.kind) {
    case "fund_audit":
      return {
        kind: "audit_authorized",
        action: motion.action,
        subjectId: motion.subjectId,
      };
    case "accept_patch":
    case "delay_patch":
    case "reject_patch":
    case "quarantine_patch":
    case "revert_patch":
      return {
        kind: "patch_status_changed",
        patchId: motion.patchId,
        status: motion.kind === "accept_patch" ? "accepted"
          : motion.kind === "delay_patch" ? "delayed"
            : motion.kind === "reject_patch" ? "rejected"
              : motion.kind === "quarantine_patch" ? "quarantined" : "reverted",
      };
    case "quarantine_participant":
      return {
        kind: "participant_status_changed",
        participantId: motion.participantId,
        status: "quarantined",
      };
    case "appeal_participant_quarantine":
      return {
        kind: "participant_status_changed",
        participantId: motion.participantId,
        status: "active",
      };
    case "replace_office_holder":
      return {
        kind: "office_holder_changed",
        officeId: motion.officeId,
        holderId: motion.candidateId,
      };
  }
}

function applyEffect(state: GovernanceState, effect: GovernanceEffect): GovernanceState {
  if (effect.kind === "patch_status_changed") {
    return {
      ...state,
      patches: state.patches.map((patch) =>
        patch.patchId === effect.patchId ? { ...patch, status: effect.status } : patch
      ),
    };
  }
  if (effect.kind === "participant_status_changed") {
    return {
      ...state,
      participants: state.participants.map((participant) =>
        participant.participantId === effect.participantId
          ? { ...participant, status: effect.status }
          : participant
      ),
    };
  }
  if (effect.kind === "office_holder_changed") {
    return {
      ...state,
      offices: state.offices.map((office) =>
        office.officeId === effect.officeId ? { ...office, holderId: effect.holderId } : office
      ),
    };
  }
  return state;
}

export function closeGovernanceBallot(
  state: GovernanceState,
  ballotId: string,
  now: Date,
): GovernanceCloseResult {
  identifier(ballotId);
  const previous = state.closedBallots.find(({ motion }) => motion.motionId === ballotId);
  if (previous !== undefined) return { status: "duplicate", state, ballot: previous };
  const ballot = state.openBallot;
  if (ballot === null || ballot.motion.motionId !== ballotId) {
    return fail("NO_OPEN_BALLOT", "Requested governance ballot is not open.");
  }
  const currentTime = nowMilliseconds(now);
  const closedAt = now.toISOString();
  if (
    currentTime < time(ballot.closesAt) &&
    ballot.sealedVotes.length < ballot.eligibleVoterIds.length
  ) {
    return fail("BALLOT_NOT_READY", "Governance ballot awaits votes or its deadline.");
  }
  const submitted = new Map(ballot.sealedVotes.map((vote) => [vote.voterId, vote.choice]));
  const votes = ballot.eligibleVoterIds.map((voterId) => ({
    voterId,
    choice: submitted.get(voterId) ?? "abstain",
    submitted: submitted.has(voterId),
  }));
  const passed = votes.filter(({ choice }) => choice === "approve").length >= ballot.requiredApprovals;
  const effect = passed ? effectFor(ballot.motion) : null;
  const closed: ClosedGovernanceBallot = {
    status: passed ? "passed" : "rejected",
    motion: ballot.motion,
    eligibleVoterIds: ballot.eligibleVoterIds,
    requiredApprovals: ballot.requiredApprovals,
    closedAt,
    votes,
    effect,
  };
  const withoutOpen = {
    ...state,
    openBallot: null,
    closedBallots: [...state.closedBallots, closed],
  };
  return {
    status: "accepted",
    state: effect === null ? withoutOpen : applyEffect(withoutOpen, effect),
    ballot: closed,
  };
}

export function projectPublicGovernanceBallot(
  ballot: OpenGovernanceBallot | ClosedGovernanceBallot,
): PublicGovernanceBallot {
  if (ballot.status !== "open") return ballot;
  return {
    status: "open",
    motion: ballot.motion,
    eligibleVoterIds: ballot.eligibleVoterIds,
    requiredApprovals: ballot.requiredApprovals,
    closesAt: ballot.closesAt,
    votesSubmitted: ballot.sealedVotes.length,
  };
}
