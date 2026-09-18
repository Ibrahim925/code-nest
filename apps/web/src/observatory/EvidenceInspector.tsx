import { useEffect, useRef, useState } from "react";

import {
  ArtifactClientError,
  type ArtifactEvidence,
  type ArtifactEvidenceClient,
} from "../evidence/domain/artifact-evidence.js";
import { sanitizeUntrustedText } from "./application/sanitize-untrusted-text.js";
import type { ActivityItem } from "./domain/activity-feed.js";

const TEXT_MEDIA = new Set([
  "text/plain",
  "text/x-diff",
  "application/json",
  "application/x-ndjson",
]);

export interface EvidenceInspectorProps {
  readonly runId: string;
  readonly selected: ActivityItem | null;
  readonly artifactClient: ArtifactEvidenceClient;
}

function contentPreview(artifact: ArtifactEvidence): string | null {
  if (!TEXT_MEDIA.has(artifact.mediaType)) return null;
  try {
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(artifact.bytes);
    return sanitizeUntrustedText(decoded, 64 * 1_024)?.text ?? null;
  } catch {
    return null;
  }
}

function safeError(error: unknown): string {
  return error instanceof ArtifactClientError
    ? error.message
    : "Artifact evidence could not be inspected.";
}

export function EvidenceInspector({
  runId,
  selected,
  artifactClient,
}: EvidenceInspectorProps): React.JSX.Element {
  const activeRequest = useRef<AbortController | null>(null);
  const [loaded, setLoaded] = useState<ArtifactEvidence | null>(null);
  const [loadingDigest, setLoadingDigest] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    activeRequest.current?.abort();
    activeRequest.current = null;
    setLoaded(null);
    setLoadingDigest(null);
    setError(null);
    return () => activeRequest.current?.abort();
  }, [selected?.id]);

  const load = async (digest: `sha256:${string}`): Promise<void> => {
    activeRequest.current?.abort();
    const request = new AbortController();
    activeRequest.current = request;
    setLoaded(null);
    setError(null);
    setLoadingDigest(digest);
    try {
      setLoaded(await artifactClient.load({ runId, digest, signal: request.signal }));
    } catch (loadError: unknown) {
      if (!request.signal.aborted) setError(safeError(loadError));
    } finally {
      if (!request.signal.aborted) setLoadingDigest(null);
    }
  };

  if (selected === null) {
    return (
      <aside className="evidence-inspector" aria-labelledby="evidence-title">
        <p className="section-kicker">Exact event context</p>
        <h2 id="evidence-title">Evidence inspector</h2>
        <div className="empty-inspector">
          Select Inspect on a Workstream item to keep its evidence in context.
        </div>
      </aside>
    );
  }

  const preview = loaded === null ? null : contentPreview(loaded);
  return (
    <aside className="evidence-inspector" aria-labelledby="evidence-title">
      <p className="section-kicker">Exact event context</p>
      <h2 id="evidence-title">{selected.title}</h2>
      <dl className="evidence-facts">
        <div><dt>Event</dt><dd>{selected.eventId}</dd></div>
        <div><dt>Actor</dt><dd>{selected.participantId ?? "controller"}</dd></div>
        <div><dt>Visibility</dt><dd>{selected.visibility.replaceAll("_", " ")}</dd></div>
        <div><dt>Verification</dt><dd>{selected.verification}</dd></div>
        <div><dt>Cause</dt><dd>{selected.causationId ?? "Not supplied"}</dd></div>
        <div><dt>Correlation</dt><dd>{selected.correlationId ?? "Not supplied"}</dd></div>
      </dl>

      {selected.body !== null && (
        <section className="evidence-body" aria-label="Selected evidence preview">
          <h3>{selected.category.replaceAll("_", " ")}</h3>
          <pre>{selected.body.text}</pre>
        </section>
      )}

      <section className="causal-parents" aria-labelledby="parents-title">
        <h3 id="parents-title">Causal parents</h3>
        {selected.parentEventIds.length === 0
          ? <p>None recorded</p>
          : <ul>{selected.parentEventIds.map((id) => <li key={id}>{id}</li>)}</ul>}
      </section>

      <section className="inspector-artifacts" aria-labelledby="artifacts-title">
        <h3 id="artifacts-title">Artifacts</h3>
        {selected.artifacts.length === 0 ? <p>None linked</p> : selected.artifacts.map(({ digest }) => (
          <div key={digest}>
            <code title={digest}>{digest}</code>
            <button
              type="button"
              disabled={loadingDigest !== null}
              onClick={() => void load(digest)}
            >{loadingDigest === digest ? "Verifying…" : "Load exact artifact"}</button>
          </div>
        ))}
      </section>

      {error !== null && <p className="inspector-error" role="alert">{error}</p>}
      {loaded !== null && (
        <section className="loaded-artifact" aria-label="Verified artifact evidence">
          <header>
            <strong>Digest verified</strong>
            <span>{loaded.mediaType} · {loaded.byteCount} bytes · {loaded.visibility}</span>
          </header>
          {loaded.mediaType === "image/svg+xml" ? (
            <p>SVG preview disabled. Active image content is never rendered inline.</p>
          ) : preview === null ? (
            <p>Binary preview unavailable. The digest and byte count were verified.</p>
          ) : (
            <pre>{preview}</pre>
          )}
          {loaded.redactedPreview.length > 0 && (
            <details><summary>Stored redacted preview</summary><pre>{loaded.redactedPreview}</pre></details>
          )}
        </section>
      )}
    </aside>
  );
}
