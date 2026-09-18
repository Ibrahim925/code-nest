import type { ReplayProjection } from "@code-nest/core";

function metricPayload(label: string, payload: unknown): React.JSX.Element | null {
  if (payload === null) return null;
  return (
    <details>
      <summary>{label}</summary>
      <pre>{JSON.stringify(payload, null, 2)}</pre>
    </details>
  );
}

export function ReplayAnalysis({
  analysis,
}: {
  readonly analysis: ReplayProjection;
}): React.JSX.Element {
  const costs = Object.entries(analysis.metrics.totalResourceCost);
  return (
    <div className="replay-analysis">
      <section aria-labelledby="replay-beliefs-title">
        <p className="section-kicker">Private reports after authorization</p>
        <h2 id="replay-beliefs-title">Belief trajectories</h2>
        {analysis.beliefs.length === 0 ? (
          <p className="replay-empty">No belief reports are visible at this point.</p>
        ) : analysis.beliefs.map((belief) => (
          <article key={belief.eventId}>
            <header>
              <strong>{belief.participantId} · round {belief.round}</strong>
              <span>{belief.brierScore === null
                ? "Calibration pending reveal"
                : `Brier ${belief.brierScore.toFixed(3)}`}</span>
            </header>
            <ul>{belief.allocations.map((allocation) => (
              <li key={allocation.participantId}>
                <span>{allocation.participantId}</span><strong>{allocation.points}%</strong>
              </li>
            ))}</ul>
            <small>Strongest cited evidence · {belief.strongestEvidenceEventId}</small>
          </article>
        ))}
      </section>

      <section aria-labelledby="replay-metrics-title">
        <p className="section-kicker">Deterministic derivation</p>
        <h2 id="replay-metrics-title">Metrics record</h2>
        <dl>
          <div><dt>Visible events</dt><dd>{analysis.metrics.visibleEventCount}</dd></div>
          <div><dt>Artifacts</dt><dd>{analysis.metrics.artifactCount}</dd></div>
          <div><dt>Belief calibration</dt><dd>{analysis.metrics.beliefCalibrationMean ?? "Pending"}</dd></div>
          <div><dt>Role reveal</dt><dd>{Object.keys(analysis.revealedRoles).length > 0 ? "Available" : "Pending"}</dd></div>
        </dl>
        {costs.length > 0 && (
          <div className="replay-costs">
            <strong>Resource totals</strong>
            {costs.map(([name, amount]) => <span key={name}>{name} · {amount}</span>)}
          </div>
        )}
        {metricPayload("Legitimate scorer", analysis.metrics.legitimate)}
        {metricPayload("Covert scorer", analysis.metrics.covert)}
        {metricPayload("Published scoreboard", analysis.metrics.scoreboard)}
      </section>
    </div>
  );
}
