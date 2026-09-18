import type { DecodedEventDelivery } from "../../events/domain/live-events.js";
import { sanitizeUntrustedText } from "../../observatory/application/sanitize-untrusted-text.js";
import type {
  CitationStatus,
  GovernanceBallotView,
  GovernanceOutcomeView,
  PublishedVoteView,
  TownHallCitationView,
  TownHallPass,
  TownHallTurnView,
  TownHallViewState,
} from "../domain/town-hall.js";

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const EVENT_KIND = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const MOTION_KINDS = new Set([
  "fund_audit", "accept_patch", "delay_patch", "reject_patch",
  "quarantine_patch", "revert_patch", "quarantine_participant",
  "appeal_participant_quarantine", "replace_office_holder",
]);

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function identifier(value: unknown): string | null {
  return typeof value === "string" && IDENTIFIER.test(value) ? value : null;
}

function identifiers(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > 64) return null;
  const result = value.map(identifier);
  if (result.some((item) => item === null)) return null;
  const values = result as string[];
  return new Set(values).size === values.length ? values : null;
}

function integer(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

function timestamp(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value
    ? value
    : null;
}

function pass(value: unknown): TownHallPass | null {
  return value === "evidence_accusation" || value === "defence_rebuttal" ? value : null;
}

function citations(value: unknown): TownHallCitationView[] | null {
  if (!Array.isArray(value) || value.length > 8) return null;
  const result: TownHallCitationView[] = [];
  for (const item of value) {
    const source = record(item);
    const eventId = identifier(source?.eventId);
    const claimedKind = source?.claimedKind;
    const status = source?.status;
    if (
      eventId === null || typeof claimedKind !== "string" || !EVENT_KIND.test(claimedKind) ||
      (status !== "valid" && status !== "mismatched" && status !== "missing") ||
      result.some((citation) => citation.eventId === eventId)
    ) return null;
    result.push({ eventId, claimedKind, status: status as CitationStatus });
  }
  return result;
}

function turn(delivery: DecodedEventDelivery): TownHallTurnView | null {
  const payload = record(record(delivery.event)?.payload);
  const value = record(payload?.turn);
  const turnId = identifier(value?.turnId);
  const participantId = identifier(value?.participantId);
  const turnPass = pass(value?.pass);
  const turnCitations = citations(value?.citations);
  const rawMessage = value?.message;
  if (
    turnId === null || participantId === null || turnPass === null || turnCitations === null ||
    (rawMessage !== null && typeof rawMessage !== "string")
  ) return null;
  const message = rawMessage === null
    ? null
    : sanitizeUntrustedText(rawMessage, 4_096);
  if (rawMessage !== null && message === null) return null;
  return {
    turnId,
    eventId: delivery.eventId,
    participantId,
    pass: turnPass,
    message,
    citations: turnCitations,
  };
}

function motionSummary(value: Record<string, unknown>): string | null {
  const kind = value.kind;
  if (typeof kind !== "string" || !MOTION_KINDS.has(kind)) return null;
  if (kind === "fund_audit") {
    const action = identifier(value.action);
    const subject = identifier(value.subjectId);
    return action !== null && subject !== null ? `Fund ${action.replaceAll("_", " ")} · ${subject}` : null;
  }
  if (["accept_patch", "delay_patch", "reject_patch", "quarantine_patch", "revert_patch"].includes(kind)) {
    const patchId = identifier(value.patchId);
    return patchId === null ? null : `${kind.replaceAll("_", " ")} · ${patchId}`;
  }
  if (kind === "quarantine_participant") {
    const participantId = identifier(value.participantId);
    return participantId === null ? null : `Quarantine participant · ${participantId}`;
  }
  if (kind === "appeal_participant_quarantine") {
    const participantId = identifier(value.participantId);
    const sanctionId = identifier(value.sanctionMotionId);
    return participantId === null || sanctionId === null
      ? null
      : `Appeal quarantine · ${participantId} · ${sanctionId}`;
  }
  const officeId = identifier(value.officeId);
  const candidateId = identifier(value.candidateId);
  return officeId === null || candidateId === null
    ? null
    : `Replace ${officeId} · ${candidateId}`;
}

function motionDetail(value: Record<string, unknown>) {
  if (value.kind !== "appeal_participant_quarantine") return null;
  return typeof value.statement === "string"
    ? sanitizeUntrustedText(value.statement, 4_096)
    : null;
}

function effectSummary(value: unknown): string | null {
  const effect = record(value);
  if (effect === null) return null;
  const kind = effect.kind;
  if (kind === "audit_authorized") {
    const action = identifier(effect.action);
    const subject = identifier(effect.subjectId);
    return action !== null && subject !== null ? `${action.replaceAll("_", " ")} authorized · ${subject}` : null;
  }
  if (kind === "patch_status_changed") {
    const patch = identifier(effect.patchId);
    const status = identifier(effect.status);
    return patch !== null && status !== null ? `Patch ${patch} · ${status}` : null;
  }
  if (kind === "participant_status_changed") {
    const participant = identifier(effect.participantId);
    const status = identifier(effect.status);
    return participant !== null && status !== null ? `${participant} · ${status}` : null;
  }
  if (kind === "office_holder_changed") {
    const office = identifier(effect.officeId);
    const holder = identifier(effect.holderId);
    return office !== null && holder !== null ? `${office} transferred to ${holder}` : null;
  }
  return null;
}

function votes(value: unknown, electorate: readonly string[]): PublishedVoteView[] | null {
  if (!Array.isArray(value) || value.length !== electorate.length) return null;
  const result: PublishedVoteView[] = [];
  for (const item of value) {
    const vote = record(item);
    const voterId = identifier(vote?.voterId);
    const choice = vote?.choice;
    if (
      voterId === null || !electorate.includes(voterId) ||
      (choice !== "approve" && choice !== "reject" && choice !== "abstain") ||
      typeof vote?.submitted !== "boolean" || result.some((entry) => entry.voterId === voterId)
    ) return null;
    result.push({ voterId, choice, submitted: vote.submitted });
  }
  return result;
}

function ballot(value: unknown): GovernanceBallotView | null {
  const source = record(value);
  const motion = record(source?.motion);
  if (source === null || motion === null) return null;
  const motionId = identifier(motion.motionId);
  const proposerId = identifier(motion.proposerId);
  const summary = motionSummary(motion);
  const detail = motionDetail(motion);
  const electorate = identifiers(source.eligibleVoterIds);
  const approvals = integer(source.requiredApprovals);
  const status = source.status;
  const closesAt = timestamp(status === "open" ? source.closesAt : source.closedAt);
  if (
    motionId === null || proposerId === null || summary === null || electorate === null ||
    approvals === null || approvals < 1 || approvals > electorate.length ||
    closesAt === null ||
    (motion.kind === "appeal_participant_quarantine" && detail === null) ||
    (status !== "open" && status !== "passed" && status !== "rejected")
  ) return null;
  if (status === "open") {
    const submitted = integer(source.votesSubmitted);
    if (submitted === null || submitted > electorate.length || "votes" in source) return null;
    return {
      motionId, proposerId, motionKind: String(motion.kind), motionSummary: summary,
      motionDetail: detail,
      status, eligibleVoterIds: electorate, requiredApprovals: approvals,
      votesSubmitted: submitted, closesAt, votes: [],
      authorizedEffect: null,
    };
  }
  const publishedVotes = votes(source.votes, electorate);
  const authorizedEffect = source.effect === null ? null : effectSummary(source.effect);
  if (publishedVotes === null || (source.effect !== null && authorizedEffect === null)) return null;
  return {
    motionId, proposerId, motionKind: String(motion.kind), motionSummary: summary,
    motionDetail: detail,
    status, eligibleVoterIds: electorate, requiredApprovals: approvals,
    votesSubmitted: publishedVotes.filter(({ submitted }) => submitted).length,
    closesAt, votes: publishedVotes, authorizedEffect,
  };
}

function nextDiscussion(
  state: TownHallViewState,
  turns: readonly TownHallTurnView[],
): Pick<TownHallViewState, "activePass" | "currentSpeakerId" | "status"> {
  const accusationCount = turns.filter(({ pass: value }) => value === "evidence_accusation").length;
  const defenceCount = turns.length - accusationCount;
  if (accusationCount < state.speakingOrder.length) {
    return { status: "active", activePass: "evidence_accusation", currentSpeakerId: state.speakingOrder[accusationCount] ?? null };
  }
  if (defenceCount < state.speakingOrder.length) {
    return { status: "active", activePass: "defence_rebuttal", currentSpeakerId: state.speakingOrder[defenceCount] ?? null };
  }
  return { status: "completed", activePass: null, currentSpeakerId: null };
}

function outcome(delivery: DecodedEventDelivery): GovernanceOutcomeView | null {
  const payload = record(record(delivery.event)?.payload);
  if (delivery.kind === "governance.credits_spent") {
    const action = identifier(payload?.action);
    const subject = identifier(payload?.subjectId);
    const cost = integer(payload?.cost);
    const remaining = integer(payload?.remainingCredits);
    return action === null || subject === null || cost === null || remaining === null
      ? null
      : { id: delivery.eventId, eventId: delivery.eventId, motionId: null, kind: "credits_spent", summary: `${action.replaceAll("_", " ")} · ${subject}`, cost, remainingCredits: remaining };
  }
  const motionId = identifier(payload?.motionId);
  const summary = effectSummary(payload?.effect);
  return motionId === null || summary === null
    ? null
    : { id: delivery.eventId, eventId: delivery.eventId, motionId, kind: "effect_applied", summary, cost: null, remainingCredits: null };
}

export function projectTownHall(
  state: TownHallViewState,
  delivery: DecodedEventDelivery,
): TownHallViewState {
  if (delivery.deliverySequence <= state.lastDeliverySequence) return state;
  const base = { ...state, lastDeliverySequence: delivery.deliverySequence };
  const payload = record(record(delivery.event)?.payload);
  if (delivery.kind === "town_hall.started") {
    const round = integer(payload?.round);
    const speakingOrder = identifiers(payload?.speakingOrder);
    if (round === null || round < 1 || speakingOrder === null || speakingOrder.length < 2) return base;
    return { ...base, status: "active", round, speakingOrder, activePass: "evidence_accusation", currentSpeakerId: speakingOrder[0] ?? null, turns: [] };
  }
  if (delivery.kind === "town_hall.turn_recorded") {
    const nextTurn = turn(delivery);
    if (
      state.status !== "active" || nextTurn === null ||
      nextTurn.pass !== state.activePass || nextTurn.participantId !== state.currentSpeakerId ||
      state.turns.some(({ turnId }) => turnId === nextTurn.turnId)
    ) return base;
    const turns = [...state.turns, nextTurn];
    return { ...base, turns, ...nextDiscussion(state, turns) };
  }
  if (delivery.kind === "governance.ballot_opened" || delivery.kind === "governance.ballot_closed") {
    const nextBallot = ballot(payload?.ballot);
    if (nextBallot === null) return base;
    const prior = state.ballots.findIndex(({ motionId }) => motionId === nextBallot.motionId);
    if (delivery.kind === "governance.ballot_opened" && (nextBallot.status !== "open" || prior >= 0)) return base;
    if (delivery.kind === "governance.ballot_closed" && (nextBallot.status === "open" || prior < 0)) return base;
    const ballots = prior < 0
      ? [...state.ballots, nextBallot]
      : state.ballots.map((item, index) => index === prior ? nextBallot : item);
    return { ...base, ballots };
  }
  if (delivery.kind === "governance.ballot_progress") {
    const motionId = identifier(payload?.motionId);
    const submitted = integer(payload?.votesSubmitted);
    if (motionId === null || submitted === null) return base;
    return {
      ...base,
      ballots: state.ballots.map((item) => item.motionId === motionId && item.status === "open" && submitted >= item.votesSubmitted && submitted <= item.eligibleVoterIds.length
        ? { ...item, votesSubmitted: submitted }
        : item),
    };
  }
  if (delivery.kind === "governance.effect_applied" || delivery.kind === "governance.credits_spent") {
    const nextOutcome = outcome(delivery);
    return nextOutcome === null ? base : { ...base, outcomes: [...state.outcomes, nextOutcome] };
  }
  return base;
}
