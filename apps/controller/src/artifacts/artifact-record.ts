import { createHash } from "node:crypto";
import { join } from "node:path";

import type {
  EventAudience,
  RevealState,
  Visibility,
} from "@code-nest/core";

export const ARTIFACT_SCHEMA_VERSION = "1.0" as const;
export const MAX_RECORD_BYTES = 16_384;

const DIGEST_PREFIX = "sha256:";
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const MEDIA_TYPE_PATTERN =
  /^[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]{0,126}\/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]{0,126}$/;
const MAX_PREVIEW_BYTES = 4_096;

export type ArtifactDigest = `sha256:${string}`;

export interface ArtifactWrite {
  runId: string;
  bytes: Uint8Array;
  mediaType: string;
  redactedPreview: string;
  visibility: Visibility;
}

export interface ArtifactReference {
  schemaVersion: typeof ARTIFACT_SCHEMA_VERSION;
  runId: string;
  digest: ArtifactDigest;
  byteCount: number;
  mediaType: string;
  redactedPreview: string;
  visibility: Visibility;
}

export interface ArtifactReadRequest {
  runId: string;
  digest: string;
  audience: EventAudience;
  revealState: RevealState;
}

export interface StoredArtifact {
  reference: ArtifactReference;
  bytes: Uint8Array;
}

export type ArtifactStoreErrorCode =
  | "ARTIFACT_METADATA_CONFLICT"
  | "CORRUPT_ARTIFACT"
  | "INVALID_ARTIFACT_DIGEST"
  | "INVALID_ARTIFACT_INPUT"
  | "STORE_IO_FAILED";

export class ArtifactStoreError extends Error {
  constructor(
    readonly code: ArtifactStoreErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "ArtifactStoreError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, expected: string[]): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  );
}

export function validateRunId(value: unknown): string {
  if (typeof value !== "string" || !IDENTIFIER_PATTERN.test(value)) {
    throw new ArtifactStoreError(
      "INVALID_ARTIFACT_INPUT",
      "Artifact run ID must be a valid protocol identifier.",
    );
  }
  return value;
}

export function validateDigest(value: unknown): ArtifactDigest {
  if (typeof value !== "string" || !DIGEST_PATTERN.test(value)) {
    throw new ArtifactStoreError(
      "INVALID_ARTIFACT_DIGEST",
      "Artifact digest must use lowercase sha256:<64 hex> form.",
    );
  }
  return value as ArtifactDigest;
}

export function validateMediaType(value: unknown): string {
  if (typeof value !== "string" || !MEDIA_TYPE_PATTERN.test(value)) {
    throw new ArtifactStoreError(
      "INVALID_ARTIFACT_INPUT",
      "Artifact media type must be a type/subtype without parameters.",
    );
  }
  return value;
}

export function validatePreview(value: unknown): string {
  if (
    typeof value !== "string" ||
    Buffer.byteLength(value, "utf8") > MAX_PREVIEW_BYTES
  ) {
    throw new ArtifactStoreError(
      "INVALID_ARTIFACT_INPUT",
      `Artifact redacted preview must be at most ${MAX_PREVIEW_BYTES} UTF-8 bytes.`,
    );
  }
  return value;
}

export function normalizeVisibility(value: unknown): Visibility {
  if (!isRecord(value) || typeof value.class !== "string") {
    throw new ArtifactStoreError(
      "INVALID_ARTIFACT_INPUT",
      "Artifact visibility is invalid.",
    );
  }
  if (
    value.class === "public" ||
    value.class === "operator_private" ||
    value.class === "post_reveal"
  ) {
    if (!hasOnlyKeys(value, ["class"])) {
      throw new ArtifactStoreError(
        "INVALID_ARTIFACT_INPUT",
        "Untargeted artifact visibility must not include recipients.",
      );
    }
    return { class: value.class };
  }
  if (value.class === "participant_private" || value.class === "covert") {
    if (
      !hasOnlyKeys(value, ["class", "recipientIds"]) ||
      !Array.isArray(value.recipientIds) ||
      value.recipientIds.length < 1 ||
      value.recipientIds.length > 64 ||
      !value.recipientIds.every(
        (recipient) =>
          typeof recipient === "string" && IDENTIFIER_PATTERN.test(recipient),
      ) ||
      new Set(value.recipientIds).size !== value.recipientIds.length
    ) {
      throw new ArtifactStoreError(
        "INVALID_ARTIFACT_INPUT",
        "Targeted artifact visibility requires unique protocol participant IDs.",
      );
    }
    return {
      class: value.class,
      recipientIds: [...value.recipientIds].sort(),
    };
  }
  throw new ArtifactStoreError(
    "INVALID_ARTIFACT_INPUT",
    "Artifact visibility class is unsupported.",
  );
}

export function copyBytes(value: unknown): Buffer {
  if (!(value instanceof Uint8Array)) {
    throw new ArtifactStoreError(
      "INVALID_ARTIFACT_INPUT",
      "Artifact bytes must be a Uint8Array.",
    );
  }
  return Buffer.from(value);
}

export function digestBytes(bytes: Uint8Array): ArtifactDigest {
  return `${DIGEST_PREFIX}${createHash("sha256").update(bytes).digest("hex")}`;
}

export function objectPath(root: string, digest: ArtifactDigest): string {
  const hex = digest.slice(DIGEST_PREFIX.length);
  return join(root, "objects", "sha256", hex.slice(0, 2), hex);
}

export function recordPath(
  root: string,
  runId: string,
  digest: ArtifactDigest,
): string {
  const hex = digest.slice(DIGEST_PREFIX.length);
  return join(
    root,
    "records",
    runId,
    "sha256",
    hex.slice(0, 2),
    `${hex}.json`,
  );
}

export function canonicalRecord(reference: ArtifactReference): string {
  return JSON.stringify(reference);
}

export function parseRecord(
  bytes: Uint8Array,
  expectedRunId: string,
  expectedDigest: ArtifactDigest,
): ArtifactReference {
  try {
    const value = JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown;
    if (
      !isRecord(value) ||
      !hasOnlyKeys(value, [
        "schemaVersion",
        "runId",
        "digest",
        "byteCount",
        "mediaType",
        "redactedPreview",
        "visibility",
      ]) ||
      value.schemaVersion !== ARTIFACT_SCHEMA_VERSION ||
      !Number.isSafeInteger(value.byteCount) ||
      (value.byteCount as number) < 0
    ) {
      throw new Error("Invalid artifact record shape.");
    }
    const reference: ArtifactReference = {
      schemaVersion: ARTIFACT_SCHEMA_VERSION,
      runId: validateRunId(value.runId),
      digest: validateDigest(value.digest),
      byteCount: value.byteCount as number,
      mediaType: validateMediaType(value.mediaType),
      redactedPreview: validatePreview(value.redactedPreview),
      visibility: normalizeVisibility(value.visibility),
    };
    if (
      reference.runId !== expectedRunId ||
      reference.digest !== expectedDigest
    ) {
      throw new Error("Artifact record identity mismatch.");
    }
    return reference;
  } catch (error: unknown) {
    throw new ArtifactStoreError(
      "CORRUPT_ARTIFACT",
      "Artifact metadata failed validation.",
      error,
    );
  }
}

export function verifyBytes(
  bytes: Uint8Array,
  reference: ArtifactReference,
): void {
  if (
    bytes.byteLength !== reference.byteCount ||
    digestBytes(bytes) !== reference.digest
  ) {
    throw new ArtifactStoreError(
      "CORRUPT_ARTIFACT",
      "Artifact bytes do not match their stored digest and size.",
    );
  }
}

export function storeFailure(
  message: string,
  error: unknown,
): ArtifactStoreError {
  return error instanceof ArtifactStoreError
    ? error
    : new ArtifactStoreError("STORE_IO_FAILED", message, error);
}
