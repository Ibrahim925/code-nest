import {
  GovernanceError,
  type GovernanceMotion,
  type GovernanceMotionRule,
  type GovernanceState,
} from "./governance-types.js";

function fail(message: string): never {
  throw new GovernanceError("MOTION_NOT_ALLOWED", message);
}

function participantTarget(motion: GovernanceMotion): string | undefined {
  return motion.kind === "quarantine_participant" ||
    motion.kind === "appeal_participant_quarantine"
    ? motion.participantId
    : undefined;
}

export function validateGovernanceRuleRestrictions(
  state: GovernanceState,
  motion: GovernanceMotion,
  rule: GovernanceMotionRule,
): void {
  if (
    motion.kind === "fund_audit" && rule.allowedAuditActions !== undefined &&
    !rule.allowedAuditActions.includes(motion.action)
  ) {
    return fail("The active constitution does not allow this audit motion.");
  }
  if (rule.requiredTarget === undefined) return;
  const target = participantTarget(motion);
  const officeId = rule.requiredTarget.officeId;
  const office = state.offices.find((item) => item.officeId === officeId);
  if (
    rule.requiredTarget.kind !== "office_holder" || target === undefined ||
    office?.holderId !== target
  ) {
    return fail("The governance motion does not target the required office holder.");
  }
}
