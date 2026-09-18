import {
  ArtifactStore,
  ArtifactStoreError,
} from "../../artifacts/store.js";
import type { ArtifactEvidenceReader } from "../application/ports/artifact-evidence-reader.js";
import {
  ArtifactEvidenceError,
  type ArtifactEvidence,
  type ArtifactEvidenceRequest,
} from "../domain/artifact-evidence.js";

export class ArtifactStoreEvidenceReader implements ArtifactEvidenceReader {
  #store: Promise<ArtifactStore> | undefined;

  constructor(private readonly root: string) {}

  async read(request: ArtifactEvidenceRequest): Promise<ArtifactEvidence | undefined> {
    try {
      this.#store ??= ArtifactStore.open(this.root);
      const artifact = await (await this.#store).read({
        runId: request.runId,
        digest: request.digest,
        audience: request.audience,
        revealState: request.revealState,
      });
      if (artifact === undefined) return undefined;
      return {
        runId: artifact.reference.runId,
        digest: artifact.reference.digest,
        byteCount: artifact.reference.byteCount,
        mediaType: artifact.reference.mediaType,
        redactedPreview: artifact.reference.redactedPreview,
        visibility: artifact.reference.visibility,
        bytes: new Uint8Array(artifact.bytes),
      };
    } catch (error: unknown) {
      if (error instanceof ArtifactStoreError && error.code === "CORRUPT_ARTIFACT") {
        throw new ArtifactEvidenceError(
          "CORRUPT_ARTIFACT",
          "Stored artifact evidence failed integrity verification.",
          error,
        );
      }
      throw new ArtifactEvidenceError(
        "ARTIFACT_STORAGE_UNAVAILABLE",
        "Artifact evidence storage is unavailable.",
        error,
      );
    }
  }
}
