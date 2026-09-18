import type { EventAudience, Visibility } from "@code-nest/core";

export interface ArtifactEvidenceRequest {
  readonly runId: string;
  readonly digest: string;
  readonly audience: EventAudience;
}

export interface ArtifactEvidence {
  readonly runId: string;
  readonly digest: `sha256:${string}`;
  readonly byteCount: number;
  readonly mediaType: string;
  readonly redactedPreview: string;
  readonly visibility: Visibility;
  readonly bytes: Uint8Array;
}

export type ArtifactEvidenceErrorCode =
  | "CORRUPT_ARTIFACT"
  | "ARTIFACT_STORAGE_UNAVAILABLE";

export class ArtifactEvidenceError extends Error {
  constructor(
    readonly code: ArtifactEvidenceErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "ArtifactEvidenceError";
  }
}
