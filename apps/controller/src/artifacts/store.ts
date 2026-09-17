import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

import { canAudienceViewVisibility } from "@code-nest/core";

import { publishImmutable, readRegularFile } from "./artifact-files.js";
import {
  ARTIFACT_SCHEMA_VERSION,
  ArtifactStoreError,
  MAX_RECORD_BYTES,
  canonicalRecord,
  copyBytes,
  digestBytes,
  normalizeVisibility,
  objectPath,
  parseRecord,
  recordPath,
  storeFailure,
  validateDigest,
  validateMediaType,
  validatePreview,
  validateRunId,
  verifyBytes,
  type ArtifactReadRequest,
  type ArtifactReference,
  type ArtifactWrite,
  type StoredArtifact,
} from "./artifact-record.js";

export {
  ARTIFACT_SCHEMA_VERSION,
  ArtifactStoreError,
  type ArtifactDigest,
  type ArtifactReadRequest,
  type ArtifactReference,
  type ArtifactStoreErrorCode,
  type ArtifactWrite,
  type StoredArtifact,
} from "./artifact-record.js";

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
      const recordBytes = await readRegularFile(
        recordPath(this.#root, runId, digest),
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
