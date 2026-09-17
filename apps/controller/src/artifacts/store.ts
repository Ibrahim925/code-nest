import { createHash, randomUUID } from "node:crypto";
import {
  link,
  lstat,
  mkdir,
  open,
  readFile,
  rm,
} from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import {
  canAudienceViewVisibility,
  type EventAudience,
  type RevealState,
  type Visibility,
} from "@code-nest/core";

export const ARTIFACT_SCHEMA_VERSION = "1.0" as const;

const DIGEST_PREFIX = "sha256:";
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const MEDIA_TYPE_PATTERN =
  /^[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]{0,126}\/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]{0,126}$/;
const MAX_PREVIEW_BYTES = 4_096;
const MAX_RECORD_BYTES = 16_384;

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

function isNodeErrorWithCode(error: unknown, code: string): boolean {
  return isRecord(error) && error.code === code;
}

function hasOnlyKeys(value: Record<string, unknown>, expected: string[]): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  );
}

function validateRunId(value: unknown): string {
  if (typeof value !== "string" || !IDENTIFIER_PATTERN.test(value)) {
    throw new ArtifactStoreError(
      "INVALID_ARTIFACT_INPUT",
      "Artifact run ID must be a valid protocol identifier.",
    );
  }
  return value;
}

function validateDigest(value: unknown): ArtifactDigest {
  if (typeof value !== "string" || !DIGEST_PATTERN.test(value)) {
    throw new ArtifactStoreError(
      "INVALID_ARTIFACT_DIGEST",
      "Artifact digest must use lowercase sha256:<64 hex> form.",
    );
  }
  return value as ArtifactDigest;
}

function validateMediaType(value: unknown): string {
  if (typeof value !== "string" || !MEDIA_TYPE_PATTERN.test(value)) {
    throw new ArtifactStoreError(
      "INVALID_ARTIFACT_INPUT",
      "Artifact media type must be a type/subtype without parameters.",
    );
  }
  return value;
}

function validatePreview(value: unknown): string {
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

function normalizeVisibility(value: unknown): Visibility {
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

function copyBytes(value: unknown): Buffer {
  if (!(value instanceof Uint8Array)) {
    throw new ArtifactStoreError(
      "INVALID_ARTIFACT_INPUT",
      "Artifact bytes must be a Uint8Array.",
    );
  }
  return Buffer.from(value);
}

function digestBytes(bytes: Uint8Array): ArtifactDigest {
  return `${DIGEST_PREFIX}${createHash("sha256").update(bytes).digest("hex")}`;
}

function objectPath(root: string, digest: ArtifactDigest): string {
  const hex = digest.slice(DIGEST_PREFIX.length);
  return join(root, "objects", "sha256", hex.slice(0, 2), hex);
}

function recordPath(
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

async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function publishImmutable(path: string, bytes: Uint8Array): Promise<boolean> {
  const parent = dirname(path);
  await mkdir(parent, { mode: 0o700, recursive: true });
  const temporaryPath = join(
    parent,
    `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`,
  );

  try {
    const handle = await open(temporaryPath, "wx", 0o600);
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }

    try {
      await link(temporaryPath, path);
      await syncDirectory(parent);
      return true;
    } catch (error: unknown) {
      if (isNodeErrorWithCode(error, "EEXIST")) return false;
      throw error;
    }
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

async function readRegularFile(
  path: string,
  exactByteCount?: number,
  maxByteCount?: number,
): Promise<Buffer | undefined> {
  try {
    const file = await lstat(path);
    if (!file.isFile()) {
      throw new ArtifactStoreError(
        "CORRUPT_ARTIFACT",
        "Artifact storage entry is not a regular file.",
      );
    }
    if (
      (exactByteCount !== undefined && file.size !== exactByteCount) ||
      (maxByteCount !== undefined && file.size > maxByteCount)
    ) {
      throw new ArtifactStoreError(
        "CORRUPT_ARTIFACT",
        "Artifact storage entry has an invalid byte count.",
      );
    }
    return await readFile(path);
  } catch (error: unknown) {
    if (isNodeErrorWithCode(error, "ENOENT")) return undefined;
    throw error;
  }
}

function canonicalRecord(reference: ArtifactReference): string {
  return JSON.stringify(reference);
}

function parseRecord(
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

function verifyBytes(bytes: Uint8Array, reference: ArtifactReference): void {
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

function storeFailure(message: string, error: unknown): ArtifactStoreError {
  return error instanceof ArtifactStoreError
    ? error
    : new ArtifactStoreError("STORE_IO_FAILED", message, error);
}

export class ArtifactStore {
  readonly #root: string;

  private constructor(root: string) {
    this.#root = root;
  }

  static async open(root: string): Promise<ArtifactStore> {
    if (typeof root !== "string" || root.length === 0) {
      throw new ArtifactStoreError(
        "INVALID_ARTIFACT_INPUT",
        "Artifact store root must be a non-empty path.",
      );
    }

    const resolvedRoot = resolve(root);
    try {
      await mkdir(resolvedRoot, { mode: 0o700, recursive: true });
      return new ArtifactStore(resolvedRoot);
    } catch (error: unknown) {
      throw storeFailure("Failed to open the artifact store.", error);
    }
  }

  async put(input: ArtifactWrite): Promise<ArtifactReference> {
    try {
      const bytes = copyBytes(input.bytes);
      const digest = digestBytes(bytes);
      const reference: ArtifactReference = {
        schemaVersion: ARTIFACT_SCHEMA_VERSION,
        runId: validateRunId(input.runId),
        digest,
        byteCount: bytes.byteLength,
        mediaType: validateMediaType(input.mediaType),
        redactedPreview: validatePreview(input.redactedPreview),
        visibility: normalizeVisibility(input.visibility),
      };

      const storedObjectPath = objectPath(this.#root, digest);
      const objectCreated = await publishImmutable(storedObjectPath, bytes);
      if (!objectCreated) {
        const existingBytes = await readRegularFile(
          storedObjectPath,
          reference.byteCount,
        );
        if (existingBytes === undefined) {
          throw new ArtifactStoreError(
            "CORRUPT_ARTIFACT",
            "Artifact object disappeared during deduplication.",
          );
        }
        verifyBytes(existingBytes, reference);
      }

      const storedRecordPath = recordPath(this.#root, reference.runId, digest);
      const recordBytes = Buffer.from(canonicalRecord(reference), "utf8");
      const recordCreated = await publishImmutable(storedRecordPath, recordBytes);
      if (!recordCreated) {
        const existingRecordBytes = await readRegularFile(
          storedRecordPath,
          undefined,
          MAX_RECORD_BYTES,
        );
        if (existingRecordBytes === undefined) {
          throw new ArtifactStoreError(
            "CORRUPT_ARTIFACT",
            "Artifact record disappeared during deduplication.",
          );
        }
        const existing = parseRecord(
          existingRecordBytes,
          reference.runId,
          reference.digest,
        );
        if (canonicalRecord(existing) !== canonicalRecord(reference)) {
          throw new ArtifactStoreError(
            "ARTIFACT_METADATA_CONFLICT",
            "Artifact digest already has different metadata in this run.",
          );
        }
      }

      return reference;
    } catch (error: unknown) {
      throw storeFailure("Failed to store the artifact.", error);
    }
  }

  async read(request: ArtifactReadRequest): Promise<StoredArtifact | undefined> {
    try {
      const runId = validateRunId(request.runId);
      const digest = validateDigest(request.digest);
      const storedRecordPath = recordPath(this.#root, runId, digest);
      const recordBytes = await readRegularFile(
        storedRecordPath,
        undefined,
        MAX_RECORD_BYTES,
      );
      if (recordBytes === undefined) return undefined;

      const reference = parseRecord(recordBytes, runId, digest);
      if (
        !canAudienceViewVisibility(reference.visibility, {
          audience: request.audience,
          revealState: request.revealState,
        })
      ) {
        return undefined;
      }

      const bytes = await readRegularFile(
        objectPath(this.#root, digest),
        reference.byteCount,
      );
      if (bytes === undefined) {
        throw new ArtifactStoreError(
          "CORRUPT_ARTIFACT",
          "Artifact metadata refers to a missing object.",
        );
      }
      verifyBytes(bytes, reference);
      return { bytes, reference };
    } catch (error: unknown) {
      throw storeFailure("Failed to read the artifact.", error);
    }
  }
}
