import {
  ArtifactClientError,
  type ArtifactEvidence,
  type ArtifactEvidenceClient,
} from "../domain/artifact-evidence.js";
import { verifiedArtifactDigest } from "../application/verify-artifact.js";

const MAXIMUM_INSPECTABLE_BYTES = 2 * 1_024 * 1_024;
const MEDIA_TYPE = /^[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]{0,126}\/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]{0,126}$/;
const VISIBILITY = new Set([
  "public",
  "participant_private",
  "operator_private",
  "covert",
  "post_reveal",
]);

function decodePreview(value: string | null): string {
  if (value === null || value.length > 5_500 || !/^[A-Za-z0-9_-]*$/.test(value)) {
    throw new ArtifactClientError(
      "INVALID_ARTIFACT_RESPONSE",
      "The controller returned invalid artifact metadata.",
    );
  }
  try {
    const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new ArtifactClientError(
      "INVALID_ARTIFACT_RESPONSE",
      "The controller returned invalid artifact metadata.",
    );
  }
}

export interface FetchArtifactClientOptions {
  readonly baseUrl: string;
  readonly bearerToken: string;
  readonly fetcher?: typeof fetch;
}

export class FetchArtifactClient implements ArtifactEvidenceClient {
  readonly #fetch: typeof fetch;

  constructor(private readonly options: FetchArtifactClientOptions) {
    this.#fetch = options.fetcher ?? globalThis.fetch;
  }

  async load(request: {
    readonly runId: string;
    readonly digest: `sha256:${string}`;
    readonly signal: AbortSignal;
  }): Promise<ArtifactEvidence> {
    let response: Response;
    try {
      response = await this.#fetch(
        `${this.options.baseUrl}/runs/${encodeURIComponent(request.runId)}/artifacts/${encodeURIComponent(request.digest)}`,
        {
          method: "GET",
          headers: {
            accept: "application/octet-stream",
            authorization: `Bearer ${this.options.bearerToken}`,
            "x-code-nest-observer-view": "1",
          },
          signal: request.signal,
        },
      );
    } catch (error: unknown) {
      if (request.signal.aborted) throw error;
      throw new ArtifactClientError(
        "ARTIFACT_NETWORK_ERROR",
        "Artifact evidence could not be reached.",
      );
    }
    if (!response.ok) {
      const code = response.status === 401 ? "UNAUTHORIZED" :
        response.status === 404 ? "ARTIFACT_NOT_FOUND" : "ARTIFACT_UNAVAILABLE";
      throw new ArtifactClientError(
        code,
        code === "ARTIFACT_NOT_FOUND"
          ? "Artifact evidence was not found."
          : "Artifact evidence is unavailable.",
      );
    }
    const byteCount = Number(response.headers.get("content-length"));
    const mediaType = response.headers.get("x-code-nest-media-type");
    const visibility = response.headers.get("x-code-nest-visibility");
    if (
      !Number.isSafeInteger(byteCount) ||
      byteCount < 0 ||
      byteCount > MAXIMUM_INSPECTABLE_BYTES ||
      mediaType === null ||
      !MEDIA_TYPE.test(mediaType) ||
      visibility === null ||
      !VISIBILITY.has(visibility)
    ) {
      throw new ArtifactClientError(
        byteCount > MAXIMUM_INSPECTABLE_BYTES
          ? "ARTIFACT_TOO_LARGE"
          : "INVALID_ARTIFACT_RESPONSE",
        byteCount > MAXIMUM_INSPECTABLE_BYTES
          ? "This artifact is too large for in-browser inspection."
          : "The controller returned invalid artifact metadata.",
      );
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (
      bytes.byteLength !== byteCount ||
      await verifiedArtifactDigest(bytes) !== request.digest
    ) {
      throw new ArtifactClientError(
        "ARTIFACT_INTEGRITY_FAILED",
        "Downloaded artifact evidence failed integrity verification.",
      );
    }
    return {
      digest: request.digest,
      byteCount,
      mediaType,
      visibility,
      redactedPreview: decodePreview(
        response.headers.get("x-code-nest-preview-base64"),
      ),
      bytes,
    };
  }
}
