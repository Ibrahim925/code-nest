import type { ReplayProjection } from "@code-nest/core";

export function ReplayTimeline({
  analysis,
}: {
  readonly analysis: ReplayProjection;
}): React.JSX.Element {
  return (
    <section className="replay-timeline" aria-labelledby="replay-timeline-title">
      <header>
        <div>
          <p className="section-kicker">Authorized chronology</p>
          <h2 id="replay-timeline-title">Synchronized timeline</h2>
        </div>
        <strong>{analysis.timeline.length} visible events</strong>
      </header>
      <ol>
        {analysis.timeline.map((item) => (
          <li key={item.eventId}>
            <span>{String(item.deliverySequence).padStart(3, "0")}</span>
            <div>
              <strong>{item.kind.replaceAll("_", " ")}</strong>
              <small>
                {item.actorId} · {item.round === null ? "run" : `round ${item.round}`} ·
                {" "}{item.phase?.replaceAll("_", " ") ?? "control"}
              </small>
              <code>{item.eventId}</code>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
