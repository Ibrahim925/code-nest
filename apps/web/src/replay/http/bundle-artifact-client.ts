import type { ReplayBundle } from "@code-nest/protocol";

import { verifiedArtifactDigest } from "../../evidence/application/verify-artifact.js";
import {
  ArtifactClientError,
  type ArtifactEvidence,
  type ArtifactEvidenceClient,
} from "../../evidence/domain/artifact-evidence.js";

const MAXIMUM_INSPECTABLE_BYTES = 2 * 1_024 * 1_024;

function decodeBase64(content: string): Uint8Array {
  try {
    const binary = atob(content);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    throw new ArtifactClientError(
      "INVALID_ARTIFACT_RESPONSE",
      "The replay artifact has invalid base64 content.",
    );
  }
}

export class BundleArtifactClient implements ArtifactEvidenceClient {
  readonly #artifacts: Map<string, ReplayBundle["artifacts"][number]>;

  constructor(private readonly bundle: ReplayBundle) {
    this.#artifacts = new Map(bundle.artifacts.map((artifact) => [artifact.digest, artifact]));
  }

  async load(request: {
    readonly runId: string;
    readonly digest: `sha256:${string}`;
    readonly signal: AbortSignal;
  }): Promise<ArtifactEvidence> {
    if (request.signal.aborted) throw request.signal.reason;
    if (request.runId !== this.bundle.runId) {
      throw new ArtifactClientError("ARTIFACT_NOT_FOUND", "Artifact evidence was not found.");
    }
    const artifact = this.#artifacts.get(request.digest);
    if (artifact === undefined) {
      throw new ArtifactClientError("ARTIFACT_NOT_FOUND", "Artifact evidence was not found.");
    }
    if (artifact.byteCount > MAXIMUM_INSPECTABLE_BYTES) {
      throw new ArtifactClientError(
        "ARTIFACT_TOO_LARGE",
        "This artifact is too large for in-browser inspection.",
      );
    }
    const bytes = decodeBase64(artifact.content);
    if (
      bytes.byteLength !== artifact.byteCount ||
      await verifiedArtifactDigest(bytes) !== artifact.digest
    ) {
      throw new ArtifactClientError(
        "ARTIFACT_INTEGRITY_FAILED",
        "Replay artifact evidence failed integrity verification.",
      );
    }
    return {
      digest: artifact.digest,
      byteCount: artifact.byteCount,
      mediaType: artifact.mediaType,
      visibility: artifact.visibility.class,
      redactedPreview: artifact.redactedPreview,
      bytes,
    };
  }
}
