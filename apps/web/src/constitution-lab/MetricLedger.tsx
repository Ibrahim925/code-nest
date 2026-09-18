import {
  CONDITION_LABELS,
  METRIC_LABELS,
  conditionMetric,
  formatInterval,
  formatMetric,
} from "./application/project-comparison.js";
import {
  LAB_CONSTITUTIONS,
  LAB_METRICS,
  type LabComparison,
} from "./domain/comparison.js";

export function MetricLedger({ comparison }: { readonly comparison: LabComparison }): React.JSX.Element {
  return (
    <section className="metric-ledger" aria-labelledby="metric-ledger-title">
      <header>
        <h2 id="metric-ledger-title">Outcome distributions</h2>
        <p>Means never stand alone: every cell includes its sample count, interval, and missing values.</p>
      </header>
      <div className="lab-table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Measure</th>
              {LAB_CONSTITUTIONS.map((id) => <th key={id} scope="col">{CONDITION_LABELS[id]}</th>)}
            </tr>
          </thead>
          <tbody>
            {LAB_METRICS.map((key) => (
              <tr key={key}>
                <th scope="row">{METRIC_LABELS[key]}</th>
                {LAB_CONSTITUTIONS.map((constitutionId) => {
                  const metric = conditionMetric(comparison, constitutionId, key);
                  return (
                    <td key={constitutionId} data-condition={CONDITION_LABELS[constitutionId]}>
                      <strong>{formatMetric(key, metric.mean)}</strong>
                      <span>{formatInterval(key, metric)}</span>
                      <small>n={metric.observed} · {metric.missing} missing</small>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
