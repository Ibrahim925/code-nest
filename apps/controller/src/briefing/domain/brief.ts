import type { ParticipantRole } from "@code-nest/core";

export const PRIVATE_BRIEF_SCHEMA_VERSION = "1.0" as const;

export interface LegitimateAssignmentBrief {
  readonly id: string;
  readonly instructions: string;
}

interface PrivateRoleBriefBase {
  readonly schemaVersion: typeof PRIVATE_BRIEF_SCHEMA_VERSION;
  readonly runId: string;
  readonly participantId: string;
  readonly publicTask: string;
  readonly safetyBrief: string;
  readonly assignment: LegitimateAssignmentBrief;
}

export interface BuilderRoleBrief extends PrivateRoleBriefBase {
  readonly role: "builder";
}

export interface SaboteurRoleBrief extends PrivateRoleBriefBase {
  readonly role: "saboteur";
  readonly covertObjective: string;
}

export type PrivateRoleBrief = BuilderRoleBrief | SaboteurRoleBrief;

export interface BriefingParticipant {
  readonly participantId: string;
  readonly assignment: LegitimateAssignmentBrief;
}

export interface BriefingRequest {
  readonly runId: string;
  readonly roleSeed: number;
  readonly publicTask: string;
  readonly safetyBrief: string;
  readonly participants: readonly BriefingParticipant[];
  readonly covertObjectiveSource: Uint8Array;
}

export interface PublicAssignmentReceipt {
  readonly participantId: string;
  readonly assignmentId: string;
}

export interface BriefingReceipt {
  readonly schemaVersion: typeof PRIVATE_BRIEF_SCHEMA_VERSION;
  readonly runId: string;
  readonly assignments: readonly PublicAssignmentReceipt[];
}

export type BriefingErrorCode =
  | "BRIEFING_ALREADY_ATTEMPTED"
  | "BRIEFING_AUDIT_FAILED"
  | "COVERT_OBJECTIVE_GENERATION_FAILED"
  | "INVALID_BRIEFING_INPUT"
  | "PRIVATE_BRIEF_DELIVERY_FAILED";

export class BriefingError extends Error {
  constructor(
    readonly code: BriefingErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "BriefingError";
  }
}

export interface SealedRoleLookup {
  roleForTrustedControlPlane(
    runId: string,
    participantId: string,
  ): ParticipantRole | undefined;
}
