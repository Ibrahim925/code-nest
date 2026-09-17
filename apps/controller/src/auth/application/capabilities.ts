import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

import type { CommandEnvelope } from "@code-nest/protocol";

import type {
  CapabilityAuditPort,
  CapabilityRejectedAuditEntry,
} from "./ports/capability-audit.js";
import {
  evaluateCapabilityScope,
  isCapabilityIdentifier,
  validateCapabilityIssue,
  type CapabilityDenialReason,
  type CapabilityIssueRequest,
} from "../domain/capability.js";

const MAX_BEARER_BYTES = 512;
const BEARER_GENERATION_ATTEMPTS = 8;
const DUMMY_DIGEST = Buffer.alloc(32);

interface StoredCapability {
  readonly tokenId: string;
  readonly runId: string;
  readonly participantId: string;
  readonly actions: readonly string[];
  readonly expiresAt: string;
  readonly expiresAtMilliseconds: number;
  readonly bearerDigest: Buffer;
  revokedAt?: string;
}

export interface IssuedCapability {
  readonly bearerToken: string;
  readonly tokenId: string;
  readonly runId: string;
  readonly participantId: string;
  readonly actions: readonly string[];
  readonly expiresAt: string;
}

export interface AuthorizedParticipantCommand {
  readonly tokenId: string;
  readonly runId: string;
  readonly participantId: string;
  readonly action: string;
  readonly commandId: string;
}

export interface CapabilityServiceDependencies {
  readonly audit: CapabilityAuditPort;
  readonly now?: () => Date;
  readonly createTokenId?: () => string;
  readonly createBearerToken?: () => string;
  readonly reservedBearerTokens: readonly string[];
}

export class CapabilityInputError extends Error {
  readonly code = "INVALID_CAPABILITY" as const;

  constructor(message: string) {
    super(message);
    this.name = "CapabilityInputError";
  }
}

export class CapabilityDeniedError extends Error {
  readonly code = "CAPABILITY_DENIED" as const;

  constructor(readonly reason: CapabilityDenialReason) {
    super("Participant capability was denied.");
    this.name = "CapabilityDeniedError";
  }
}

export class CapabilityService {
  readonly #capabilities = new Map<string, StoredCapability>();
  readonly #usedCommandIdsByRun = new Map<string, Set<string>>();
  readonly #reservedBearerDigests: ReadonlySet<string>;
  readonly #now: () => Date;
  readonly #createTokenId: () => string;
  readonly #createBearerToken: () => string;

  constructor(private readonly dependencies: CapabilityServiceDependencies) {
    this.#reservedBearerDigests = new Set(
      dependencies.reservedBearerTokens.map((token) =>
        digestBearer(token).toString("hex"),
      ),
    );
    this.#now = dependencies.now ?? (() => new Date());
    this.#createTokenId = dependencies.createTokenId ?? randomUUID;
    this.#createBearerToken =
      dependencies.createBearerToken ??
      (() => `cn_cap_${randomBytes(32).toString("base64url")}`);
  }

  issue(request: CapabilityIssueRequest): IssuedCapability {
    const now = this.#readNow();
    const validated = validateCapabilityIssue(request, now.getTime());
    if (validated === undefined) {
      throw new CapabilityInputError("Capability scope or expiry is invalid.");
    }

    const tokenId = this.#createTokenId();
    if (
      !isCapabilityIdentifier(tokenId) ||
      this.#capabilities.has(tokenId)
    ) {
      throw new CapabilityInputError("Capability token ID is invalid or reused.");
    }
    const bearerToken = this.#generateBearerToken();
    const actions = Object.freeze([...validated.actions]);
    const capability: StoredCapability = {
      tokenId,
      runId: validated.runId,
      participantId: validated.participantId,
      actions,
      expiresAt: validated.expiresAt,
      expiresAtMilliseconds: validated.expiresAtMilliseconds,
      bearerDigest: digestBearer(bearerToken),
    };

    this.dependencies.audit.record({
      kind: "issued",
      recordedAt: now.toISOString(),
      tokenId,
      runId: capability.runId,
      participantId: capability.participantId,
      actions: [...capability.actions],
      expiresAt: capability.expiresAt,
    });
    this.#capabilities.set(tokenId, capability);

    return {
      bearerToken,
      tokenId,
      runId: capability.runId,
      participantId: capability.participantId,
      actions: [...capability.actions],
      expiresAt: capability.expiresAt,
    };
  }

  authorize(
    bearerToken: unknown,
    command: CommandEnvelope,
  ): AuthorizedParticipantCommand {
    const now = this.#readNow();
    const claimedTokenId = command.capability.tokenId;
    const capability =
      claimedTokenId === null
        ? undefined
        : this.#capabilities.get(claimedTokenId);

    if (!credentialMatches(bearerToken, capability?.bearerDigest)) {
      return this.#deny("invalid_credential", command, capability, now);
    }
    if (capability === undefined) {
      return this.#deny("invalid_credential", command, undefined, now);
    }

    const reason = evaluateCapabilityScope(
      {
        runId: capability.runId,
        participantId: capability.participantId,
        actions: capability.actions,
        expiresAtMilliseconds: capability.expiresAtMilliseconds,
        revoked: capability.revokedAt !== undefined,
        usedCommandIds:
          this.#usedCommandIdsByRun.get(capability.runId) ?? new Set<string>(),
      },
      command,
      now.getTime(),
    );
    if (reason !== undefined) {
      return this.#deny(reason, command, capability, now);
    }

    let usedCommandIds = this.#usedCommandIdsByRun.get(capability.runId);
    if (usedCommandIds === undefined) {
      usedCommandIds = new Set<string>();
      this.#usedCommandIdsByRun.set(capability.runId, usedCommandIds);
    }
    usedCommandIds.add(command.commandId);
    return {
      tokenId: capability.tokenId,
      runId: capability.runId,
      participantId: capability.participantId,
      action: command.kind,
      commandId: command.commandId,
    };
  }

  revoke(tokenId: string, reason: string): boolean {
    const capability = this.#capabilities.get(tokenId);
    if (capability === undefined || capability.revokedAt !== undefined) {
      return false;
    }
    if (!isCapabilityIdentifier(reason)) {
      throw new CapabilityInputError("Capability revocation reason is invalid.");
    }

    const now = this.#readNow();
    capability.revokedAt = now.toISOString();
    this.dependencies.audit.record({
      kind: "revoked",
      recordedAt: capability.revokedAt,
      tokenId: capability.tokenId,
      runId: capability.runId,
      participantId: capability.participantId,
      reason,
    });
    return true;
  }

  revokeRun(runId: string, reason: string): number {
    let revoked = 0;
    for (const capability of this.#capabilities.values()) {
      if (capability.runId === runId && this.revoke(capability.tokenId, reason)) {
        revoked += 1;
      }
    }
    return revoked;
  }

  #deny(
    reason: CapabilityDenialReason,
    command: CommandEnvelope,
    capability: StoredCapability | undefined,
    now: Date,
  ): never {
    const entry: CapabilityRejectedAuditEntry = {
      kind: "rejected",
      recordedAt: now.toISOString(),
      tokenId: capability?.tokenId ?? command.capability.tokenId ?? "unknown",
      runId: capability?.runId ?? command.runId ?? "unknown",
      participantId: capability?.participantId ?? command.actor.id,
      reason,
      requestCommandId: command.commandId,
      requestedAction: command.kind,
      claimedRunId: command.runId,
      claimedParticipantId: command.actor.id,
      claimedTokenId: command.capability.tokenId,
    };
    this.dependencies.audit.record(entry);
    throw new CapabilityDeniedError(reason);
  }

  #generateBearerToken(): string {
    for (let attempt = 0; attempt < BEARER_GENERATION_ATTEMPTS; attempt += 1) {
      const bearerToken = this.#createBearerToken();
      if (
        isValidBearer(bearerToken) &&
        !this.#reservedBearerDigests.has(
          digestBearer(bearerToken).toString("hex"),
        ) &&
        ![...this.#capabilities.values()].some((capability) =>
          credentialMatches(bearerToken, capability.bearerDigest),
        )
      ) {
        return bearerToken;
      }
    }
    throw new CapabilityInputError("A distinct bearer token could not be issued.");
  }

  #readNow(): Date {
    const now = this.#now();
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
      throw new CapabilityInputError("Capability clock returned an invalid time.");
    }
    return now;
  }
}

function isValidBearer(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 32 &&
    Buffer.byteLength(value, "utf8") <= MAX_BEARER_BYTES
  );
}

function digestBearer(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function credentialMatches(
  bearerToken: unknown,
  expectedDigest: Buffer | undefined,
): boolean {
  const actualDigest = isValidBearer(bearerToken)
    ? digestBearer(bearerToken)
    : DUMMY_DIGEST;
  return timingSafeEqual(actualDigest, expectedDigest ?? DUMMY_DIGEST) &&
    expectedDigest !== undefined;
}
