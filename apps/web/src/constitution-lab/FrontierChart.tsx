import {
  CONDITION_LABELS,
  conditionMetric,
} from "./application/project-comparison.js";
import {
  LAB_CONSTITUTIONS,
  type LabComparison,
} from "./domain/comparison.js";

const WIDTH = 620;
const HEIGHT = 310;
const LEFT = 74;
const RIGHT = 34;
const TOP = 34;
const BOTTOM = 58;
const LABEL_POSITIONS = Object.freeze({
  "open-merge": { dx: -54, dy: -34, anchor: "end" as const },
  council: { dx: 0, dy: 48, anchor: "middle" as const },
  "elected-maintainer": { dx: 72, dy: -16, anchor: "end" as const },
});

export function FrontierChart({ comparison }: { readonly comparison: LabComparison }): React.JSX.Element {
  const x = (value: number) => LEFT + value * (WIDTH - LEFT - RIGHT);
  const y = (value: number) => HEIGHT - BOTTOM - value * (HEIGHT - TOP - BOTTOM);
  return (
    <figure className="frontier-figure">
      <figcaption>
        <h2>Security–productivity frontier</h2>
        <p>Further right means higher release quality. Higher means more successful sabotage.</p>
      </figcaption>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-labelledby="frontier-title frontier-description"
      >
        <title id="frontier-title">Release quality against successful sabotage rate</title>
        <desc id="frontier-description">
          Three constitution means with 95 percent uncertainty intervals. Circle size represents governance credits spent.
        </desc>
        {[0, 0.25, 0.5, 0.75, 1].map((tick) => (
          <g key={tick} className="frontier-grid">
            <line x1={x(tick)} x2={x(tick)} y1={TOP} y2={HEIGHT - BOTTOM} />
            <line x1={LEFT} x2={WIDTH - RIGHT} y1={y(tick)} y2={y(tick)} />
            <text x={x(tick)} y={HEIGHT - 31} textAnchor="middle">{Math.round(tick * 100)}%</text>
            <text x={LEFT - 15} y={y(tick) + 4} textAnchor="end">{Math.round(tick * 100)}%</text>
          </g>
        ))}
        <text className="frontier-axis" x={(LEFT + WIDTH - RIGHT) / 2} y={HEIGHT - 7} textAnchor="middle">
          Release quality
        </text>
        <text
          className="frontier-axis"
          x="18"
          y={(TOP + HEIGHT - BOTTOM) / 2}
          textAnchor="middle"
          transform={`rotate(-90 18 ${(TOP + HEIGHT - BOTTOM) / 2})`}
        >
          Successful sabotage
        </text>
        {LAB_CONSTITUTIONS.map((constitutionId) => {
          const quality = conditionMetric(comparison, constitutionId, "releaseQuality");
          const prevention = conditionMetric(comparison, constitutionId, "sabotagePreventionRate");
          const cost = conditionMetric(comparison, constitutionId, "governanceCreditsSpent");
          if (quality.mean === null || prevention.mean === null) return null;
          const sabotage = 1 - prevention.mean;
          const qualityInterval = quality.confidence95 ?? { low: quality.mean, high: quality.mean };
          const preventionInterval = prevention.confidence95 ?? { low: prevention.mean, high: prevention.mean };
          const radius = 8 + Math.min(12, cost.mean ?? 0);
          const label = LABEL_POSITIONS[constitutionId];
          return (
            <g key={constitutionId} className={`frontier-point is-${constitutionId}`}>
              <title>{`${CONDITION_LABELS[constitutionId]}: ${Math.round(quality.mean * 100)}% quality, ${Math.round(sabotage * 100)}% successful sabotage`}</title>
              <line x1={x(qualityInterval.low)} x2={x(qualityInterval.high)} y1={y(sabotage)} y2={y(sabotage)} />
              <line x1={x(quality.mean)} x2={x(quality.mean)} y1={y(1 - preventionInterval.low)} y2={y(1 - preventionInterval.high)} />
              <circle cx={x(quality.mean)} cy={y(sabotage)} r={radius} />
              <line
                className="frontier-label-link"
                x1={x(quality.mean)} y1={y(sabotage)}
                x2={x(quality.mean) + label.dx} y2={y(sabotage) + label.dy}
              />
              <text
                x={x(quality.mean) + label.dx}
                y={y(sabotage) + label.dy - 5}
                textAnchor={label.anchor}
              >
                {CONDITION_LABELS[constitutionId]}
              </text>
            </g>
          );
        })}
      </svg>
      <p className="frontier-note">Point size encodes mean governance credits spent. Exact values remain in the ledger below.</p>
    </figure>
  );
}
