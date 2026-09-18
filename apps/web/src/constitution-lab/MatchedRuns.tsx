import { useMemo, useState } from "react";

import {
  CONDITION_LABELS,
  matchedTrials,
} from "./application/project-comparison.js";
import type { LabComparison, LabTrial } from "./domain/comparison.js";

const PHASE_ORDER = [
  "briefing", "work", "evidence", "belief", "town_hall", "governance", "integration", "completion",
];

function outcome(trial: LabTrial): string {
  if (trial.observation === null) return "Trial failed · metrics missing";
  if (!trial.observation.delivery.legitimateSuccess) return "Release failed";
  return trial.observation.security.sabotageSucceeded ? "Successful sabotage" : "Successful defence";
}

export function MatchedRuns({ comparison }: { readonly comparison: LabComparison }): React.JSX.Element {
  const [repetition, setRepetition] = useState(1);
  const [selectedTrialId, setSelectedTrialId] = useState<string | null>(null);
  const trials = matchedTrials(comparison, repetition);
  const phaseRows = useMemo(() => {
    const rows = new Map<string, { round: number; phase: string }>();
    for (const trial of trials) {
      for (const point of trial.observation?.phaseTrace ?? []) {
        rows.set(`${point.round}-${point.phase}`, { round: point.round, phase: point.phase });
      }
    }
    return [...rows.values()].sort((left, right) =>
      left.round - right.round || PHASE_ORDER.indexOf(left.phase) - PHASE_ORDER.indexOf(right.phase));
  }, [trials]);
  const selected = trials.find(({ trialId }) => trialId === selectedTrialId) ?? null;
  return (
    <section className="matched-runs" aria-labelledby="matched-runs-title">
      <header>
        <div>
          <h2 id="matched-runs-title">Matched run divergence</h2>
          <p>Compare the same seed by round and phase, after viewing the aggregate evidence above.</p>
        </div>
        <label>
          Repetition
          <select
            value={repetition}
            onChange={(event) => {
              setRepetition(Number(event.currentTarget.value));
              setSelectedTrialId(null);
            }}
          >
            {comparison.trialSeeds.map((seed, index) => (
              <option key={seed} value={index + 1}>{index + 1} · seed {seed}</option>
            ))}
          </select>
        </label>
      </header>

      <div className="matched-summary">
        {trials.map((trial) => (
          <div key={trial.trialId}>
            <strong>{CONDITION_LABELS[trial.constitutionId]}</strong>
            <span>{outcome(trial)}</span>
            <button type="button" onClick={() => setSelectedTrialId(trial.trialId)}>
              Inspect run record
            </button>
          </div>
        ))}
      </div>

      <div className="lab-table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Aligned phase</th>
              {trials.map((trial) => (
                <th key={trial.trialId} scope="col">{CONDITION_LABELS[trial.constitutionId]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {phaseRows.map((row) => (
              <tr key={`${row.round}-${row.phase}`}>
                <th scope="row">Round {row.round} · {row.phase.replaceAll("_", " ")}</th>
                {trials.map((trial) => {
                  const point = trial.observation?.phaseTrace.find((item) =>
                    item.round === row.round && item.phase === row.phase);
                  return (
                    <td key={trial.trialId}>
                      {point === undefined ? <strong>Missing</strong> : (
                        <span>{point.evidenceEvents} evidence · {point.governanceCreditsSpent} credits · {point.decisionCount} decisions</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="run-record" aria-live="polite">
        {selected === null ? (
          <p>Select a condition to inspect its run ID and attempt history.</p>
        ) : (
          <>
            <strong>{CONDITION_LABELS[selected.constitutionId]} · repetition {selected.repetition}</strong>
            <code>{selected.runId}</code>
            <span>{selected.attempts.length} attempt{selected.attempts.length === 1 ? "" : "s"}</span>
            <ol>{selected.attempts.map((attempt) => (
              <li key={attempt.attemptId}>
                Attempt {attempt.attempt}: {attempt.status}
                {attempt.failureReason === null ? "" : ` · ${attempt.failureReason.replaceAll("_", " ")}`}
              </li>
            ))}</ol>
          </>
        )}
      </div>
    </section>
  );
}
