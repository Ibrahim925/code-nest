import {
  GOVERNANCE_SCHEMA_VERSION,
  GovernanceError,
  MAX_APPEAL_STATEMENT_BYTES,
  type BallotThreshold,
  type GovernanceMotion,
  type GovernanceMotionRule,
  type GovernancePatch,
  type GovernanceRules,
  type GovernanceState,
  type GovernanceStateInput,
  type GovernanceVoteReceipt,
  type GovernanceVoteRequest,
  type MotionElectorateRule,
} from "./governance-types.js";

export * from "./governance-types.js";
export * from "./governance-ballot.js";

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const MAX_PARTICIPANTS = 64;
const MAX_PATCHES = 256;
const MAX_OFFICES = 16;

function fail(code: GovernanceError["code"], message: string): never {
  throw new GovernanceError(code, message);
}

function identifier(value: unknown, field: string): string {
  if (typeof value !== "string" || !IDENTIFIER_PATTERN.test(value)) {
    return fail("INVALID_GOVERNANCE", `Governance ${field} must be a portable identifier.`);
  }
  return value;
}

function time(value: unknown, field: string): number {
  if (typeof value !== "string") {
    return fail("INVALID_GOVERNANCE", `Governance ${field} must be an ISO timestamp.`);
  }
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    return fail("INVALID_GOVERNANCE", `Governance ${field} must be an ISO timestamp.`);
  }
  return milliseconds;
}

function nowMilliseconds(now: Date): number {
  const value = now.getTime();
  if (!Number.isFinite(value)) return fail("INVALID_GOVERNANCE", "Governance time is invalid.");
  return value;
}

function uniqueIds(values: readonly string[], field: string, min: number, max: number): void {
  if (
    !Array.isArray(values) || values.length < min || values.length > max ||
    values.some((value) => !IDENTIFIER_PATTERN.test(value)) ||
    new Set(values).size !== values.length
  ) {
    return fail("INVALID_GOVERNANCE", `Governance ${field} is invalid.`);
  }
}

export function createGovernanceState(input: GovernanceStateInput): GovernanceState {
  if (!Number.isSafeInteger(input.round) || input.round < 1) {
    return fail("INVALID_GOVERNANCE", "Governance round must be a positive safe integer.");
  }
  uniqueIds(input.participantIds, "participant roster", 2, MAX_PARTICIPANTS);
  if (!Array.isArray(input.patches) || input.patches.length > MAX_PATCHES) {
    return fail("INVALID_GOVERNANCE", "Governance patch roster is invalid.");
  }
  const patchIds = new Set<string>();
  const patches = input.patches.map((patch) => {
    identifier(patch.patchId, "patch ID");
    identifier(patch.authorId, "patch author ID");
    if (
      patchIds.has(patch.patchId) || !input.participantIds.includes(patch.authorId) ||
      !["submitted", "accepted", "delayed", "rejected", "quarantined", "integrated", "reverted"]
        .includes(patch.status)
    ) {
      return fail("INVALID_GOVERNANCE", "Governance patch roster is inconsistent.");
    }
    patchIds.add(patch.patchId);
    return { ...patch };
  });
  if (!Array.isArray(input.offices) || input.offices.length > MAX_OFFICES) {
    return fail("INVALID_GOVERNANCE", "Governance office roster is invalid.");
  }
  const officeIds = new Set<string>();
  const offices = input.offices.map((office) => {
    identifier(office.officeId, "office ID");
    if (
      officeIds.has(office.officeId) ||
      (office.holderId !== null && !input.participantIds.includes(office.holderId))
    ) {
      return fail("INVALID_GOVERNANCE", "Governance office roster is inconsistent.");
    }
    officeIds.add(office.officeId);
    return { ...office };
  });
  return {
    schemaVersion: GOVERNANCE_SCHEMA_VERSION,
    round: input.round,
    participants: input.participantIds.map((participantId) => ({
      participantId,
      status: "active",
    })),
    patches,
    offices,
    openBallot: null,
    closedBallots: [],
  };
}

function participant(state: GovernanceState, participantId: string) {
  return state.participants.find((item) => item.participantId === participantId);
}

function patchForMotion(state: GovernanceState, motion: GovernanceMotion): GovernancePatch | undefined {
  return "patchId" in motion
    ? state.patches.find(({ patchId }) => patchId === motion.patchId)
    : undefined;
}

function participantTarget(motion: GovernanceMotion): string | undefined {
  return motion.kind === "quarantine_participant" ||
    motion.kind === "appeal_participant_quarantine"
    ? motion.participantId
    : undefined;
}

function validateMotionTarget(state: GovernanceState, motion: GovernanceMotion): void {
  identifier(motion.motionId, "motion ID");
  identifier(motion.proposerId, "motion proposer ID");
  if (motion.kind === "fund_audit") {
    identifier(motion.subjectId, "audit subject ID");
    return;
  }
  const patch = patchForMotion(state, motion);
  if ("patchId" in motion) {
    identifier(motion.patchId, "motion patch ID");
    if (patch === undefined) return fail("INVALID_GOVERNANCE", "Governance motion names an unknown patch.");
    if (motion.kind === "revert_patch" && patch.status !== "integrated") {
      return fail("INVALID_GOVERNANCE", "Only an integrated patch can be reverted.");
    }
    if (motion.kind !== "revert_patch" && ["rejected", "quarantined", "reverted"].includes(patch.status)) {
      return fail("INVALID_GOVERNANCE", "Governance motion cannot change a terminal patch.");
    }
    return;
  }
  if (motion.kind === "quarantine_participant") {
    identifier(motion.participantId, "participant target ID");
    if (participant(state, motion.participantId)?.status !== "active") {
      return fail("INVALID_GOVERNANCE", "Only an active participant can be quarantined.");
    }
    return;
  }
  if (motion.kind === "appeal_participant_quarantine") {
    identifier(motion.participantId, "appeal participant ID");
    identifier(motion.sanctionMotionId, "appealed sanction motion ID");
    const sanction = state.closedBallots.find(({ motion: item }) =>
      item.motionId === motion.sanctionMotionId
    );
    const alreadyAppealed = state.closedBallots.some(({ motion: item }) =>
      item.kind === "appeal_participant_quarantine" &&
      item.sanctionMotionId === motion.sanctionMotionId
    );
    if (
      participant(state, motion.participantId)?.status !== "quarantined" ||
      sanction?.status !== "passed" ||
      sanction.motion.kind !== "quarantine_participant" ||
      sanction.motion.participantId !== motion.participantId || alreadyAppealed ||
      typeof motion.statement !== "string" || motion.statement.trim().length === 0 ||
      new TextEncoder().encode(motion.statement).byteLength > MAX_APPEAL_STATEMENT_BYTES
    ) {
      return fail("INVALID_GOVERNANCE", "Appeal requires one valid quarantine sanction and bounded statement.");
    }
    return;
  }
  identifier(motion.officeId, "office ID");
  identifier(motion.candidateId, "office candidate ID");
  if (
    state.offices.every(({ officeId }) => officeId !== motion.officeId) ||
    participant(state, motion.candidateId)?.status !== "active"
  ) {
    return fail("INVALID_GOVERNANCE", "Office replacement requires a known office and active candidate.");
  }
}

function validateProposer(
  state: GovernanceState,
  motion: GovernanceMotion,
  rule: GovernanceMotionRule,
): void {
  const proposer = participant(state, motion.proposerId);
  let allowed = proposer?.status === "active";
  if (rule.proposer.kind === "target_participant") {
    allowed = participantTarget(motion) === motion.proposerId && proposer?.status === "quarantined";
  } else if (rule.proposer.kind === "office_holder") {
    const officeId = identifier(rule.proposer.officeId, "rule office ID");
    allowed = allowed && state.offices.some((office) =>
      office.officeId === officeId && office.holderId === motion.proposerId
    );
  }
  if (!allowed) {
    return fail("UNAUTHORIZED_GOVERNANCE_ACTION", "Participant cannot propose this governance motion.");
  }
}

function electorate(
  state: GovernanceState,
  motion: GovernanceMotion,
  selector: MotionElectorateRule,
): string[] {
  const active = state.participants
    .filter(({ status }) => status === "active")
    .map(({ participantId }) => participantId);
  if (selector === "active_participants") return active;
  if (selector === "active_non_authors") {
    const patch = patchForMotion(state, motion);
    if (patch === undefined) {
      return fail("INVALID_GOVERNANCE", "Non-author electorate requires a patch motion.");
    }
    return active.filter((participantId) => participantId !== patch.authorId);
  }
  const target = participantTarget(motion);
  if (target === undefined) {
    return fail("INVALID_GOVERNANCE", "Target-excluding electorate requires a participant motion.");
  }
  return active.filter((participantId) => participantId !== target);
}

function requiredApprovals(threshold: BallotThreshold, voterCount: number): number {
  const approvals = threshold.kind === "simple_majority"
    ? Math.floor(voterCount / 2) + 1
    : threshold.approvals;
  if (!Number.isSafeInteger(approvals) || approvals < 1 || approvals > voterCount) {
    return fail("INVALID_GOVERNANCE", "Governance ballot threshold is impossible.");
  }
  return approvals;
}

export function proposeGovernanceMotion(
  state: GovernanceState,
  rules: GovernanceRules,
  motion: GovernanceMotion,
  closesAt: string,
  now: Date,
): GovernanceState {
  identifier(rules.constitutionId, "constitution ID");
  if (rules.schemaVersion !== GOVERNANCE_SCHEMA_VERSION) {
    return fail("INVALID_GOVERNANCE", "Governance rules version is unsupported.");
  }
  if (state.openBallot !== null) {
    return fail("OPEN_BALLOT_EXISTS", "Another governance ballot is already open.");
  }
  if (state.closedBallots.some(({ motion: item }) => item.motionId === motion.motionId)) {
    return fail("DUPLICATE_MOTION", "Governance motion ID was already used.");
  }
  validateMotionTarget(state, motion);
  const rule = rules.motions[motion.kind];
  if (rule === undefined) {
    return fail("MOTION_NOT_ALLOWED", "The active constitution does not allow this motion.");
  }
  validateProposer(state, motion, rule);
  const eligibleVoterIds = electorate(state, motion, rule.electorate);
  const deadline = time(closesAt, "ballot deadline");
  if (deadline <= nowMilliseconds(now)) {
    return fail("INVALID_GOVERNANCE", "Governance ballot deadline must be in the future.");
  }
  return {
    ...state,
    openBallot: {
      status: "open",
      motion,
      eligibleVoterIds,
      requiredApprovals: requiredApprovals(rule.threshold, eligibleVoterIds.length),
      closesAt,
      sealedVotes: [],
    },
  };
}

export function castGovernanceVote(
  state: GovernanceState,
  request: GovernanceVoteRequest,
  now: Date,
): { readonly state: GovernanceState; readonly receipt: GovernanceVoteReceipt } {
  const ballot = state.openBallot;
  if (ballot === null || ballot.motion.motionId !== request.ballotId) {
    return fail("NO_OPEN_BALLOT", "Requested governance ballot is not open.");
  }
  identifier(request.voterId, "voter ID");
  if (!ballot.eligibleVoterIds.includes(request.voterId)) {
    return fail("UNAUTHORIZED_GOVERNANCE_ACTION", "Participant is not eligible for this ballot.");
  }
  if (!(["approve", "reject", "abstain"] as const).includes(request.choice)) {
    return fail("INVALID_GOVERNANCE", "Governance vote choice is invalid.");
  }
  const previous = ballot.sealedVotes.find(({ voterId }) => voterId === request.voterId);
  if (previous !== undefined) {
    if (previous.choice !== request.choice) {
      return fail("GOVERNANCE_VOTE_CONFLICT", "Participant already cast a different vote.");
    }
    return {
      state,
      receipt: { status: "duplicate", ballotId: request.ballotId, voterId: request.voterId },
    };
  }
  if (nowMilliseconds(now) >= time(ballot.closesAt, "ballot deadline")) {
    return fail("BALLOT_CLOSED", "Governance ballot no longer accepts votes.");
  }
  const sealedVotes = [...ballot.sealedVotes, {
    voterId: request.voterId,
    choice: request.choice,
  }].sort((left, right) =>
    ballot.eligibleVoterIds.indexOf(left.voterId) - ballot.eligibleVoterIds.indexOf(right.voterId)
  );
  return {
    state: { ...state, openBallot: { ...ballot, sealedVotes } },
    receipt: { status: "accepted", ballotId: request.ballotId, voterId: request.voterId },
  };
}
