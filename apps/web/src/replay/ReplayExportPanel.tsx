import { useState } from "react";

import type { ReplayClient } from "./http/replay-client.js";
import { downloadReplayBundle, ReplayClientError } from "./http/replay-client.js";

export interface ReplayExportPanelProps {
  readonly runId: string;
  readonly ready: boolean;
  readonly client: ReplayClient;
}

export function ReplayExportPanel({
  runId,
  ready,
  client,
}: ReplayExportPanelProps): React.JSX.Element {
  const [status, setStatus] = useState<"idle" | "exporting" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);

  const exportReplay = async (): Promise<void> => {
    setStatus("exporting");
    setError(null);
    try {
      downloadReplayBundle(await client.export(runId));
      setStatus("saved");
    } catch (cause: unknown) {
      setStatus("idle");
      setError(cause instanceof ReplayClientError
        ? cause.message
        : "Replay export failed unexpectedly.");
    }
  };

  return (
    <section className="replay-export" aria-labelledby="replay-export-title">
      <div>
        <p className="section-kicker">Portable record</p>
        <h2 id="replay-export-title">Offline replay</h2>
        <p>
          The saved file contains this authorized perspective and its immutable evidence.
          It never contains credentials.
        </p>
      </div>
      <div className="replay-export-action">
        <strong>{ready ? "Ready to export" : "Available when the run ends"}</strong>
        <button
          type="button"
          disabled={!ready || status === "exporting"}
          onClick={() => void exportReplay()}
        >
          {status === "exporting" ? "Building replay…" : "Save replay bundle"}
        </button>
        <span aria-live="polite">{status === "saved" ? "Replay saved." : ""}</span>
        {error !== null && <span className="replay-error" role="alert">{error}</span>}
      </div>
    </section>
  );
}
