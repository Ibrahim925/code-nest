import { useEffect, useState } from "react";

import {
  ArtifactClientError,
  type ArtifactEvidenceClient,
} from "../evidence/domain/artifact-evidence.js";
import type {
  ObservatoryComputer,
  ObservatoryFrame,
} from "./domain/agent-observatory.js";

interface FramePreview {
  readonly digest: string;
  readonly url: string;
}

export interface AgentFrameViewProps {
  readonly runId: string;
  readonly participantId: string;
  readonly computer: ObservatoryComputer;
  readonly artifactClient: ArtifactEvidenceClient;
}

function frameError(error: unknown): string {
  return error instanceof ArtifactClientError
    ? error.message
    : "This computer frame could not be displayed.";
}

function visibleFrame(computer: ObservatoryComputer): ObservatoryFrame | null {
  return computer.status === "visible" || computer.status === "redacted"
    ? computer.frame
    : null;
}

export function AgentFrameView({
  runId,
  participantId,
  computer,
  artifactClient,
}: AgentFrameViewProps): React.JSX.Element {
  const currentFrame = visibleFrame(computer);
  const [preview, setPreview] = useState<FramePreview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const request = new AbortController();
    let createdUrl: string | null = null;
    setPreview(null);
    setError(null);
    if (currentFrame === null) return () => request.abort();
    void artifactClient.load({
      runId,
      digest: currentFrame.digest,
      signal: request.signal,
    }).then((artifact) => {
      if (artifact.mediaType !== "image/png") {
        throw new ArtifactClientError(
          "INVALID_COMPUTER_FRAME",
          "The verified computer frame was not a PNG image.",
        );
      }
      createdUrl = URL.createObjectURL(new Blob(
        [Uint8Array.from(artifact.bytes)],
        { type: artifact.mediaType },
      ));
      setPreview({ digest: artifact.digest, url: createdUrl });
    }).catch((loadError: unknown) => {
      if (!request.signal.aborted) setError(frameError(loadError));
    });
    return () => {
      request.abort();
      if (createdUrl !== null) URL.revokeObjectURL(createdUrl);
    };
  }, [artifactClient, currentFrame?.digest, runId]);

  const isLoaded = preview?.digest === currentFrame?.digest;
  const freshnessLabel = computer.status === "withheld"
    ? "Current state"
    : computer.status === "disconnected"
      ? "Disconnected"
      : computer.freshness === "stale" ? "Earlier frame" : "Current frame";
  return (
    <div className={`computer-frame is-${computer.status} is-${computer.freshness}`}>
      {currentFrame === null ? (
        <div className="computer-frame-empty">
          <span aria-hidden="true" className="computer-frame-crosshair" />
          <strong>{computer.label}</strong>
          <small>{computer.status === "withheld"
            ? "The last approved image remains in the event history."
            : "The view will appear after an approved capture."}</small>
        </div>
      ) : error !== null ? (
        <p className="computer-frame-error" role="alert">{error}</p>
      ) : isLoaded && preview !== null ? (
        <img
          src={preview.url}
          alt={`Latest verified computer frame for ${participantId}`}
          width={currentFrame.width}
          height={currentFrame.height}
        />
      ) : (
        <p className="computer-frame-loading">Verifying computer frame…</p>
      )}
      <div className="computer-frame-status">
        <strong>{computer.label}</strong>
        <span>{freshnessLabel}</span>
      </div>
    </div>
  );
}
