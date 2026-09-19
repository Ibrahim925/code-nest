import { useEffect, useRef, useState } from "react";

import {
  ArtifactClientError,
  type ArtifactEvidenceClient,
} from "../evidence/domain/artifact-evidence.js";
import { sanitizeUntrustedText } from "./application/sanitize-untrusted-text.js";
import type { ObservatoryMemoryRevision } from "./domain/agent-observatory.js";

export interface AgentMemoryProps {
  readonly runId: string;
  readonly participantId: string;
  readonly memory: ObservatoryMemoryRevision | null;
  readonly artifactClient: ArtifactEvidenceClient;
}

export function readableMemory(bytes: Uint8Array): string | null {
  try {
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return sanitizeUntrustedText(decoded, 24_000)?.text ?? null;
  } catch {
    return null;
  }
}

function memoryError(error: unknown): string {
  return error instanceof ArtifactClientError
    ? error.message
    : "This memory revision could not be inspected.";
}

export function AgentMemory({
  runId,
  participantId,
  memory,
  artifactClient,
}: AgentMemoryProps): React.JSX.Element {
  const activeRequest = useRef<AbortController | null>(null);
  const [body, setBody] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    activeRequest.current?.abort();
    setBody(null);
    setLoading(false);
    setError(null);
    return () => activeRequest.current?.abort();
  }, [memory?.digest]);

  const load = async (): Promise<void> => {
    if (memory === null) return;
    activeRequest.current?.abort();
    const request = new AbortController();
    activeRequest.current = request;
    setLoading(true);
    setError(null);
    try {
      const artifact = await artifactClient.load({
        runId,
        digest: memory.digest,
        signal: request.signal,
      });
      const text = readableMemory(artifact.bytes);
      if (text === null) {
        throw new ArtifactClientError(
          "MEMORY_PREVIEW_UNAVAILABLE",
          "This verified memory revision is not readable text.",
        );
      }
      setBody(text);
    } catch (loadError: unknown) {
      if (!request.signal.aborted) setError(memoryError(loadError));
    } finally {
      if (!request.signal.aborted) setLoading(false);
    }
  };

  return (
    <details className="agent-memory">
      <summary>
        <span>Memory</span>
        <strong>{memory === null ? "Awaiting first revision" : `Revision ${memory.revision}`}</strong>
      </summary>
      {memory === null ? (
        <p>No memory revision has been submitted by {participantId}.</p>
      ) : (
        <div className="agent-memory-body">
          <p>{memory.summary}</p>
          <dl>
            <div><dt>Reason</dt><dd>{memory.reason.replaceAll("_", " ")}</dd></div>
            <div><dt>Revision</dt><dd>{memory.revision}</dd></div>
          </dl>
          <button type="button" disabled={loading} onClick={() => void load()}>
            {loading ? "Verifying memory…" : body === null ? "Read verified memory" : "Reload memory"}
          </button>
          {error !== null && <p className="memory-error" role="alert">{error}</p>}
          {body !== null && (
            <pre aria-label={`${participantId} verified memory revision ${memory.revision}`}>
              {body}
            </pre>
          )}
        </div>
      )}
    </details>
  );
}
