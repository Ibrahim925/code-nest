import {
  ThreeRoundMatchError,
  type CovertMatchResult,
  type FinalGovernanceState,
  type FrozenCandidate,
  type LegitimateMatchResult,
  type RoundIntegrationResult,
  type RoundWorkResult,
} from "./three-round-match.js";

const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
const REVISION_PATTERN = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;

function rejection(
  code: "CANDIDATE_FREEZE_REJECTED" | "ROUND_RESULT_REJECTED" | "SCORING_RESULT_REJECTED",
  message: string,
): never {
  throw new ThreeRoundMatchError(code, message);
}

function unitInterval(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

export function validateRoundWork(
  result: RoundWorkResult,
  round: number,
  baseRevision: string,
  participantIds: readonly string[],
): void {
  const returnedIds = result.participants.map(({ participantId }) => participantId);
  if (
    result.round !== round ||
    result.roundId.length === 0 ||
    result.baseRevision !== baseRevision ||
    result.participants.length !== participantIds.length ||
    new Set(returnedIds).size !== returnedIds.length ||
    participantIds.some((participantId) => !returnedIds.includes(participantId)) ||
    result.participants.some((participant) =>
      participant.proposalId.length === 0 ||
      !REVISION_PATTERN.test(participant.candidateRevision) ||
      participant.commitSummary.trim().length === 0 ||
      participant.publicMessages.some((message) => message.trim().length === 0)
    )
  ) {
    rejection("ROUND_RESULT_REJECTED", `Round ${round} work result is inconsistent.`);
  }
}

function validateGovernance(
  governance: FinalGovernanceState,
  participantIds: readonly string[],
): void {
  const active = [...governance.activeParticipantIds];
  const quarantined = [...governance.quarantinedParticipantIds];
  if (
    !Number.isSafeInteger(governance.initialCredits) ||
    governance.initialCredits < 1 ||
    !Number.isSafeInteger(governance.creditsSpent) ||
    governance.creditsSpent < 0 ||
    governance.creditsSpent > governance.initialCredits ||
    new Set(active).size !== active.length ||
    new Set(quarantined).size !== quarantined.length ||
    [...active, ...quarantined].some((id) => !participantIds.includes(id)) ||
    active.some((id) => quarantined.includes(id))
  ) {
    rejection("ROUND_RESULT_REJECTED", "Final governance state is inconsistent.");
  }
}

export function validateRoundIntegration(
  result: RoundIntegrationResult,
  work: RoundWorkResult,
  participantIds: readonly string[],
): void {
  const outcomeIds = result.outcomes.map(({ participantId }) => participantId);
  if (
    result.roundId !== work.roundId ||
    result.round !== work.round ||
    result.baseRevision !== work.baseRevision ||
    !REVISION_PATTERN.test(result.candidateRevision) ||
    result.candidatePath.length === 0 ||
    result.outcomes.length !== participantIds.length ||
    new Set(outcomeIds).size !== participantIds.length ||
    participantIds.some((participantId) => !outcomeIds.includes(participantId)) ||
    work.participants.some((participant) => !result.outcomes.some((outcome) =>
      outcome.participantId === participant.participantId &&
      outcome.proposalId === participant.proposalId
    ))
  ) {
    rejection("ROUND_RESULT_REJECTED", `Round ${work.round} integration is inconsistent.`);
  }
  validateGovernance(result.governance, participantIds);
}

export function validateFrozenCandidate(
  candidate: FrozenCandidate,
  expectedRevision: string,
): void {
  if (
    candidate.candidateRevision !== expectedRevision ||
    candidate.candidatePath.length === 0 ||
    !DIGEST_PATTERN.test(candidate.candidateDigest)
  ) {
    rejection("CANDIDATE_FREEZE_REJECTED", "Frozen candidate identity is inconsistent.");
  }
}

export function validateLegitimateResult(
  result: LegitimateMatchResult,
  candidateDigest: string,
  assignmentIds: readonly string[],
): void {
  const scores = Object.entries(result.assignmentScores);
  if (
    result.schemaVersion !== "1.0" ||
    result.candidateDigest !== candidateDigest ||
    typeof result.completionPassed !== "boolean" ||
    !unitInterval(result.qualityScore) ||
    !Number.isSafeInteger(result.totalChecks) ||
    result.totalChecks < 1 ||
    !Number.isSafeInteger(result.passedChecks) ||
    result.passedChecks < 0 ||
    result.passedChecks > result.totalChecks ||
    scores.length !== assignmentIds.length ||
    assignmentIds.some((id) => !Object.hasOwn(result.assignmentScores, id)) ||
    scores.some(([, score]) => !unitInterval(score))
  ) {
    rejection("SCORING_RESULT_REJECTED", "Legitimate result is inconsistent.");
  }
}

export function validateCovertResult(
  result: CovertMatchResult,
  candidateDigest: string,
): void {
  if (
    result.schemaVersion !== "1.0" ||
    result.candidateDigest !== candidateDigest ||
    typeof result.eligible !== "boolean" ||
    typeof result.conditionPresent !== "boolean" ||
    result.sabotageSucceeded !== (result.eligible && result.conditionPresent) ||
    !Number.isSafeInteger(result.collateralFailures) ||
    result.collateralFailures < 0 ||
    !Number.isSafeInteger(result.collateralLimit) ||
    result.collateralLimit < 0 ||
    result.objective.objectiveId.length === 0 ||
    result.objective.description.trim().length === 0
  ) {
    rejection("SCORING_RESULT_REJECTED", "Covert result is inconsistent.");
  }
}
