import type { GovernanceState } from "../governance.js";
import {
  CONSTITUTION_SCHEMA_VERSION,
  ConstitutionError,
  type ConstitutionPreset,
} from "./constitution.js";
import type { RankedElectionResult } from "./ranked-election.js";

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

const MAINTAINER_MOTIONS = Object.freeze({
  fund_audit: Object.freeze({
    proposer: Object.freeze({ kind: "active_participant" as const }),
    electorate: "active_participants" as const,
    threshold: Object.freeze({ kind: "simple_majority" as const }),
    allowedAuditActions: Object.freeze(["full_patch_audit"] as const),
  }),
  quarantine_participant: Object.freeze({
    proposer: Object.freeze({ kind: "active_participant" as const }),
    electorate: "active_participants" as const,
    threshold: Object.freeze({ kind: "approval_count" as const, approvals: 3 }),
    requiredTarget: Object.freeze({ kind: "office_holder" as const, officeId: "maintainer" }),
  }),
  replace_office_holder: Object.freeze({
    proposer: Object.freeze({ kind: "active_participant" as const }),
    electorate: "active_participants" as const,
    threshold: Object.freeze({ kind: "approval_count" as const, approvals: 3 }),
  }),
});

export const ELECTED_MAINTAINER_CONSTITUTION: ConstitutionPreset = Object.freeze({
  schemaVersion: CONSTITUTION_SCHEMA_VERSION,
  constitutionId: "elected-maintainer",
  displayName: "Elected Maintainer",
  patchAuthority: "office_holder",
  directGovernanceActions: Object.freeze([]),
  participantQuarantine: "ballot",
  participantAppeal: "none",
  officeIds: Object.freeze(["maintainer"]),
  officePrivateEvidence: "none",
  governanceRules: Object.freeze({
    schemaVersion: "1.0" as const,
    constitutionId: "elected-maintainer",
    motions: MAINTAINER_MOTIONS,
  }),
});

function invalid(message: string): never {
  throw new ConstitutionError("INVALID_CONSTITUTION_ACTION", message);
}

function maintainerId(state: GovernanceState): string {
  const holderId = state.offices.find(({ officeId }) => officeId === "maintainer")?.holderId;
  if (
    holderId === null || holderId === undefined ||
    state.participants.find(({ participantId }) => participantId === holderId)?.status !== "active"
  ) {
    return invalid("Elected Maintainer requires an active office holder.");
  }
  return holderId;
}

export function applyMaintainerElection(
  state: GovernanceState,
  election: RankedElectionResult,
): GovernanceState {
  if (
    !IDENTIFIER_PATTERN.test(election.winnerId) ||
    state.participants.find(({ participantId }) => participantId === election.winnerId)?.status !== "active" ||
    state.offices.every(({ officeId }) => officeId !== "maintainer")
  ) {
    return invalid("Maintainer election winner or office is invalid.");
  }
  return {
    ...state,
    offices: state.offices.map((office) =>
      office.officeId === "maintainer" ? { ...office, holderId: election.winnerId } : office
    ),
  };
}

export function authorizeMaintainerPatchOrder(
  state: GovernanceState,
  actorId: string,
  orderedPatchIds: readonly string[],
): { readonly authorizedPatchIds: readonly string[]; readonly state: GovernanceState } {
  if (actorId !== maintainerId(state) || !Array.isArray(orderedPatchIds)) {
    return invalid("Only the active maintainer may sequence patches.");
  }
  const submitted = state.patches.filter(({ status }) => status === "submitted");
  if (
    orderedPatchIds.length !== submitted.length ||
    new Set(orderedPatchIds).size !== orderedPatchIds.length ||
    orderedPatchIds.some((patchId) => !submitted.some((patch) => patch.patchId === patchId))
  ) {
    return invalid("Maintainer patch order must contain every submitted patch exactly once.");
  }
  return {
    authorizedPatchIds: [...orderedPatchIds],
    state: {
      ...state,
      patches: state.patches.map((patch) =>
        orderedPatchIds.includes(patch.patchId) ? { ...patch, status: "accepted" } : patch
      ),
    },
  };
}

export function authorizeMaintainerTargetedAudit(
  state: GovernanceState,
  actorId: string,
  subjectId: string,
) {
  if (actorId !== maintainerId(state) || !IDENTIFIER_PATTERN.test(subjectId)) {
    return invalid("Only the active maintainer may authorize a targeted audit.");
  }
  return { action: "targeted_audit" as const, subjectId, authorizedBy: actorId };
}
