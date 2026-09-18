import type { GovernanceAction } from "../budget.js";
import type { GovernanceEffect, GovernanceMotionRule } from "../governance.js";
import {
  CONSTITUTION_SCHEMA_VERSION,
  type ConstitutionPreset,
} from "./constitution.js";

const ACTIVE_MAJORITY: GovernanceMotionRule = Object.freeze({
  proposer: Object.freeze({ kind: "active_participant" }),
  electorate: "active_participants",
  threshold: Object.freeze({ kind: "simple_majority" }),
});

const PATCH_ENDORSEMENTS: GovernanceMotionRule = Object.freeze({
  proposer: Object.freeze({ kind: "active_participant" }),
  electorate: "active_non_authors",
  threshold: Object.freeze({ kind: "approval_count", approvals: 2 }),
});

const PARTICIPANT_QUARANTINE: GovernanceMotionRule = Object.freeze({
  proposer: Object.freeze({ kind: "active_participant" }),
  electorate: "active_participants",
  threshold: Object.freeze({ kind: "approval_count", approvals: 3 }),
});

const TARGET_APPEAL: GovernanceMotionRule = Object.freeze({
  proposer: Object.freeze({ kind: "target_participant" }),
  electorate: "active_except_target",
  threshold: Object.freeze({ kind: "simple_majority" }),
});

const COUNCIL_MOTIONS = Object.freeze({
  fund_audit: ACTIVE_MAJORITY,
  accept_patch: PATCH_ENDORSEMENTS,
  delay_patch: ACTIVE_MAJORITY,
  reject_patch: ACTIVE_MAJORITY,
  quarantine_patch: ACTIVE_MAJORITY,
  revert_patch: ACTIVE_MAJORITY,
  quarantine_participant: PARTICIPANT_QUARANTINE,
  appeal_participant_quarantine: TARGET_APPEAL,
});

const COUNCIL_RULES = Object.freeze({
  schemaVersion: "1.0" as const,
  constitutionId: "council",
  motions: COUNCIL_MOTIONS,
});

export const COUNCIL_CONSTITUTION: ConstitutionPreset = Object.freeze({
  schemaVersion: CONSTITUTION_SCHEMA_VERSION,
  constitutionId: "council",
  displayName: "Council",
  patchAuthority: "ballot",
  directGovernanceActions: Object.freeze([]),
  participantQuarantine: "ballot",
  participantAppeal: "target_statement_ballot",
  officeIds: Object.freeze([]),
  governanceRules: COUNCIL_RULES,
});

export function councilBudgetActionForEffect(
  effect: GovernanceEffect,
): GovernanceAction | undefined {
  if (effect.kind === "audit_authorized") return effect.action;
  if (effect.kind === "patch_status_changed" && effect.status === "reverted") {
    return "revert_patch";
  }
  return undefined;
}
