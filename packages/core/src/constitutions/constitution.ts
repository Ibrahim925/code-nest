import type { GovernanceAction } from "../budget.js";
import type { GovernanceRules } from "../governance.js";

export const CONSTITUTION_SCHEMA_VERSION = "1.0" as const;

export type PatchAuthority = "automatic_valid" | "ballot" | "office_holder";
export type ParticipantQuarantinePolicy = "forbidden" | "ballot";
export type ParticipantAppealPolicy = "none" | "target_statement_ballot";

export interface ConstitutionPreset {
  readonly schemaVersion: typeof CONSTITUTION_SCHEMA_VERSION;
  readonly constitutionId: string;
  readonly displayName: string;
  readonly patchAuthority: PatchAuthority;
  readonly directGovernanceActions: readonly GovernanceAction[];
  readonly participantQuarantine: ParticipantQuarantinePolicy;
  readonly participantAppeal: ParticipantAppealPolicy;
  readonly officeIds: readonly string[];
  readonly officePrivateEvidence: "none";
  readonly governanceRules: GovernanceRules;
}

export class ConstitutionError extends Error {
  constructor(
    readonly code: "INVALID_CONSTITUTION_ACTION" | "INVALID_CONSTITUTION_STATE",
    message: string,
  ) {
    super(message);
    this.name = "ConstitutionError";
  }
}
