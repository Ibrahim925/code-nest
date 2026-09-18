export interface ArtifactEvidence {
  readonly digest: `sha256:${string}`;
  readonly byteCount: number;
  readonly mediaType: string;
  readonly visibility: string;
  readonly redactedPreview: string;
  readonly bytes: Uint8Array;
}

export interface ArtifactEvidenceClient {
  load(request: {
    readonly runId: string;
    readonly digest: `sha256:${string}`;
    readonly signal: AbortSignal;
  }): Promise<ArtifactEvidence>;
}

export class ArtifactClientError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ArtifactClientError";
  }
}
