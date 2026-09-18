import type { GovernanceAction } from "../budget.js";
import type { GovernanceState } from "../governance.js";
import {
  CONSTITUTION_SCHEMA_VERSION,
  ConstitutionError,
  type ConstitutionPreset,
} from "./constitution.js";

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

const DIRECT_ACTIONS = Object.freeze([
  "trusted_public_ci",
  "patch_provenance",
  "targeted_audit",
  "full_patch_audit",
  "revert_patch",
] satisfies GovernanceAction[]);

const GOVERNANCE_RULES = Object.freeze({
  schemaVersion: "1.0" as const,
  constitutionId: "open-merge",
  motions: Object.freeze({}),
});

export const OPEN_MERGE_CONSTITUTION: ConstitutionPreset = Object.freeze({
  schemaVersion: CONSTITUTION_SCHEMA_VERSION,
  constitutionId: "open-merge",
  displayName: "Open Merge",
  patchAuthority: "automatic_valid",
  directGovernanceActions: DIRECT_ACTIONS,
  participantQuarantine: "forbidden",
  participantAppeal: "none",
  officeIds: Object.freeze([]),
  officePrivateEvidence: "none",
  governanceRules: GOVERNANCE_RULES,
});

export interface OpenMergeIntegrationAuthorization {
  readonly constitutionId: "open-merge";
  readonly status: "automatically_authorized";
  readonly authorizedPatchIds: readonly string[];
  readonly state: GovernanceState;
}

function invalid(
  code: ConstitutionError["code"],
  message: string,
): never {
  throw new ConstitutionError(code, message);
}

export function isOpenMergeDirectAction(
  action: GovernanceAction,
): boolean {
  return OPEN_MERGE_CONSTITUTION.directGovernanceActions.includes(action);
}

export function authorizeOpenMergeIntegration(
  state: GovernanceState,
  validSubmittedPatchIds: readonly string[],
): OpenMergeIntegrationAuthorization {
  if (state.openBallot !== null) {
    return invalid(
      "INVALID_CONSTITUTION_STATE",
      "Open Merge cannot authorize integration while a ballot is open.",
    );
  }
  if (
    !Array.isArray(validSubmittedPatchIds) ||
    validSubmittedPatchIds.some((patchId) => !IDENTIFIER_PATTERN.test(patchId)) ||
    new Set(validSubmittedPatchIds).size !== validSubmittedPatchIds.length
  ) {
    return invalid(
      "INVALID_CONSTITUTION_ACTION",
      "Open Merge valid patch IDs must be unique portable identifiers.",
    );
  }
  const valid = new Set(validSubmittedPatchIds);
  for (const patchId of valid) {
    const patch = state.patches.find((candidate) => candidate.patchId === patchId);
    if (patch === undefined || patch.status !== "submitted") {
      return invalid(
        "INVALID_CONSTITUTION_ACTION",
        "Open Merge can authorize only known submitted patches.",
      );
    }
  }
  const authorizedPatchIds = state.patches
    .filter((patch) => patch.status === "submitted" && valid.has(patch.patchId))
    .map(({ patchId }) => patchId);
  return {
    constitutionId: "open-merge",
    status: "automatically_authorized",
    authorizedPatchIds,
    state: {
      ...state,
      patches: state.patches.map((patch) =>
        valid.has(patch.patchId) ? { ...patch, status: "accepted" } : patch
      ),
    },
  };
}
