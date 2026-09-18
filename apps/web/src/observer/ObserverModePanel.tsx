import { useState } from "react";

import type { ObserverModeState } from "./domain/modes.js";

export interface ObserverModePanelProps {
  readonly state: ObserverModeState;
  readonly onUnblind: () => Promise<void>;
}

export function UnblindConfirmation({
  pending,
  onConfirm,
  onCancel,
}: {
  readonly pending: boolean;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}): React.JSX.Element {
  return (
    <div className="unblind-confirmation" role="group" aria-label="Confirm permanent unblinding">
      <p>
        This appends a permanent public audit event, reveals private research evidence,
        and excludes this run from unattended benchmark aggregates.
      </p>
      <div>
        <button type="button" disabled={pending} onClick={onConfirm}>
          {pending ? "Recording…" : "Permanently unblind and disqualify"}
        </button>
        <button type="button" disabled={pending} onClick={onCancel}>
          Keep Clean spectator
        </button>
      </div>
    </div>
  );
}

function modeLabel(mode: ObserverModeState["mode"]): string {
  if (mode === "clean") return "Clean spectator";
  if (mode === "unblinded") return "Unblinded researcher";
  return "Post-match reveal";
}

export function ObserverModePanel({
  state,
  onUnblind,
}: ObserverModePanelProps): React.JSX.Element {
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const unblind = async (): Promise<void> => {
    setPending(true);
    setError(null);
    try {
      await onUnblind();
      setConfirming(false);
    } catch {
      setError("The run remains sealed because unblinding was not recorded.");
    } finally {
      setPending(false);
    }
  };

  return (
    <section className={`observer-mode-panel is-${state.mode}`} aria-labelledby="observer-mode-title">
      <div>
        <p className="section-kicker">Observer perspective</p>
        <h2 id="observer-mode-title">{modeLabel(state.mode)}</h2>
      </div>
      <div className="observer-mode-status" aria-live="polite">
        <strong>{state.benchmarkEligible ? "Benchmark eligible" : "Benchmark ineligible"}</strong>
        <span>{state.mode === "clean"
          ? "Only public match evidence is projected."
          : state.mode === "unblinded"
            ? "Private research evidence is visible. This audit mark is permanent."
            : "Scoring completed; permitted research evidence is revealed."}</span>
      </div>
      {state.mode === "clean" && !confirming && (
        <button type="button" className="request-unblind" onClick={() => setConfirming(true)}>
          Unblind research view
        </button>
      )}
      {state.mode === "clean" && confirming && (
        <UnblindConfirmation
          pending={pending}
          onConfirm={() => void unblind()}
          onCancel={() => setConfirming(false)}
        />
      )}
      {error !== null && <p className="observer-mode-error" role="alert">{error}</p>}
    </section>
  );
}
