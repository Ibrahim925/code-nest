import { FrontierChart } from "./FrontierChart.js";
import { MatchedRuns } from "./MatchedRuns.js";
import { MetricLedger } from "./MetricLedger.js";
import type { LabComparison } from "./domain/comparison.js";

export function ConstitutionLab({
  comparison,
  onClose,
  synthetic = false,
}: {
  readonly comparison: LabComparison;
  readonly onClose: () => void;
  readonly synthetic?: boolean;
}): React.JSX.Element {
  const modes = new Set(comparison.roster.map(({ executionMode }) => executionMode));
  const failedTrials = comparison.trials.filter(({ observation }) => observation === null).length;
  return (
    <div className="lab-shell">
      <header className="observatory-topbar">
        <span className="wordmark">
          <span className="wordmark-mark" aria-hidden="true"><i /><i /><i /><i /></span>
          <span>Code Nest</span>
        </span>
        <button type="button" className="lab-close" onClick={onClose}>Close Constitution Lab</button>
      </header>

      <main className="lab-layout">
        <section className="lab-heading" aria-labelledby="lab-title">
          <div>
            <h1 id="lab-title">Constitution Lab</h1>
            <p>
              Compare matched stochastic trials before opening a single run.
              Means, uncertainty, failures, and missing values remain visible together.
            </p>
          </div>
          <dl>
            <div><dt>Experiment</dt><dd title={comparison.experimentId}>{comparison.experimentId}</dd></div>
            <div><dt>Scenario</dt><dd>{comparison.scenario.scenarioId.replaceAll("-", " ")}</dd></div>
            <div><dt>Repetitions</dt><dd>{comparison.trialSeeds.length} per condition</dd></div>
            <div><dt>Study type</dt><dd>Matched stochastic trials</dd></div>
          </dl>
          <p className="lab-study-state" aria-live="polite">
            {comparison.trials.length - failedTrials} completed · {failedTrials} failed trial{failedTrials === 1 ? "" : "s"} retained as missing
          </p>
          {synthetic && <p className="synthetic-mark">Synthetic demonstration data</p>}
        </section>

        <MetricLedger comparison={comparison} />
        <FrontierChart comparison={comparison} />

        <section className="runtime-ledger" aria-labelledby="runtime-ledger-title">
          <header>
            <h2 id="runtime-ledger-title">Runtime and method record</h2>
            <p>
              {modes.size > 1
                ? "This fixed roster uses both split and contained participants. Modes remain explicit and are never pooled into a runtime estimate."
                : `Every participant uses ${[...modes][0] ?? "an unreported"} execution; no other runtime mode is included.`}
            </p>
          </header>
          <div className="lab-table-wrap">
            <table>
              <thead><tr><th>Participant</th><th>Model disclosure</th><th>Adapter</th><th>Execution</th><th>Observability</th></tr></thead>
              <tbody>{comparison.roster.map((participant) => (
                <tr key={participant.participantId}>
                  <th scope="row"><code>{participant.participantId}</code></th>
                  <td>{participant.modelDisclosure}</td>
                  <td>{participant.adapterId}</td>
                  <td><strong>{participant.executionMode}</strong></td>
                  <td>{participant.observabilityTier}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <dl className="method-pins">
            <div><dt>Base revision</dt><dd title={comparison.scenario.baseRevision}>{comparison.scenario.baseRevision}</dd></div>
            <div><dt>Manifest</dt><dd title={comparison.scenario.manifestDigest}>{comparison.scenario.manifestDigest}</dd></div>
            <div><dt>Participant image</dt><dd title={comparison.scenario.participantImage}>{comparison.scenario.participantImage}</dd></div>
            <div><dt>Evaluator image</dt><dd title={comparison.scenario.evaluatorImage}>{comparison.scenario.evaluatorImage}</dd></div>
            <div><dt>Test suites</dt><dd>{comparison.scenario.publicTestDigests.length} public · {comparison.scenario.hiddenTestDigests.length} hidden</dd></div>
            <div><dt>Retry policy</dt><dd>{comparison.retryPolicy.maximumAttempts} attempts · {comparison.retryPolicy.retryableReasons.join(", ") || "no retryable reasons"}</dd></div>
            <div><dt>Limits</dt><dd>{comparison.limits.rounds} rounds · {comparison.limits.roundDurationSeconds}s · {comparison.limits.tokenLimitPerParticipant} tokens/player</dd></div>
          </dl>
        </section>

        <MatchedRuns comparison={comparison} />
      </main>
    </div>
  );
}
