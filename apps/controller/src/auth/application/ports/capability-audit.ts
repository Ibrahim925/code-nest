import type { CapabilityDenialReason } from "../../domain/capability.js";

interface AuditEntryBase {
  readonly recordedAt: string;
  readonly tokenId: string;
  readonly runId: string;
  readonly participantId: string;
}

export interface CapabilityIssuedAuditEntry extends AuditEntryBase {
  readonly kind: "issued";
  readonly actions: readonly string[];
  readonly expiresAt: string;
}

export interface CapabilityRejectedAuditEntry extends AuditEntryBase {
  readonly kind: "rejected";
  readonly reason: CapabilityDenialReason;
  readonly requestCommandId: string;
  readonly requestedAction: string;
  readonly claimedRunId: string | null;
  readonly claimedParticipantId: string;
  readonly claimedTokenId: string | null;
}

export interface CapabilityRevokedAuditEntry extends AuditEntryBase {
  readonly kind: "revoked";
  readonly reason: string;
}

export type CapabilityAuditEntry =
  | CapabilityIssuedAuditEntry
  | CapabilityRejectedAuditEntry
  | CapabilityRevokedAuditEntry;

export interface CapabilityAuditPort {
  record(entry: CapabilityAuditEntry): void;
}

export class CapabilityAuditError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "CapabilityAuditError";
  }
}
