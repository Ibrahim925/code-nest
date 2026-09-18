import { useState } from "react";

import type { RunMutation } from "./client.js";
import type { RunControlView } from "./domain.js";

export interface RunControlsProps {
  readonly run: RunControlView;
  readonly pendingAction: "start" | RunMutation | null;
  readonly onMutation: (action: RunMutation) => void;
}

export function runStatusLabel(run: RunControlView): string {
  if (run.status === "cancelled") return "Cancelled · partial replay preserved";
  return run.status === "paused" ? "Paused · phase clock held" : "Running";
}

export function RunControls({
  run,
  pendingAction,
  onMutation,
}: RunControlsProps): React.JSX.Element {
  const [confirmCancel, setConfirmCancel] = useState(false);
  return (
    <section className="run-controls" aria-labelledby="run-controls-title">
      <div className="run-state">
        <span>Status</span>
        <strong id="run-controls-title">{runStatusLabel(run)}</strong>
        <small>Durable event {run.lastEventSequence}</small>
      </div>
      {run.status !== "cancelled" && (
        <div className="control-actions">
          {run.status === "running" ? (
            <button
              type="button"
              disabled={pendingAction !== null}
              onClick={() => onMutation("pause")}
            >
              Pause
            </button>
          ) : (
            <button
              type="button"
              disabled={pendingAction !== null}
              onClick={() => onMutation("resume")}
            >
              Resume
            </button>
          )}
          {!confirmCancel ? (
            <button
              className="danger-action"
              type="button"
              disabled={pendingAction !== null}
              onClick={() => setConfirmCancel(true)}
            >
              Cancel…
            </button>
          ) : (
            <div
              className="cancel-confirm"
              role="group"
              aria-label="Confirm cancellation"
            >
              <p>Cancel and preserve a partial replay?</p>
              <button type="button" onClick={() => onMutation("cancel")}>
                Confirm cancel
              </button>
              <button type="button" onClick={() => setConfirmCancel(false)}>
                Keep running
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
