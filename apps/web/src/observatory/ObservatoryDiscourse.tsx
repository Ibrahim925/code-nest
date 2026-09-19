import type {
  ObservatoryDiscourseItem,
  ObservatoryTimelineItem,
} from "./domain/agent-observatory.js";

const VISIBLE_ITEMS = 80;

export interface ObservatoryDiscourseProps {
  readonly discourse: readonly ObservatoryDiscourseItem[];
  readonly timeline: readonly ObservatoryTimelineItem[];
}

export function ObservatoryDiscourse({
  discourse,
  timeline,
}: ObservatoryDiscourseProps): React.JSX.Element {
  const visibleDiscourse = discourse.slice(-VISIBLE_ITEMS);
  const visibleTimeline = timeline.slice(-VISIBLE_ITEMS);
  return (
    <aside className="observatory-record" aria-label="Live discourse and timeline">
      <section className="discourse-panel" aria-labelledby="discourse-title">
        <header>
          <h2 id="discourse-title">Live discourse</h2>
          <span>{discourse.length} messages</span>
        </header>
        {visibleDiscourse.length === 0 ? (
          <p className="record-empty">Public discussion has not started.</p>
        ) : (
          <ol>
            {visibleDiscourse.map((item) => (
              <li key={item.id}>
                <div>
                  <strong>{item.participantId}</strong>
                  <span>{item.channel.replaceAll("_", " ")}</span>
                </div>
                <p>{item.yielded ? "Yielded this turn." : item.body}</p>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="observatory-timeline" aria-labelledby="observatory-timeline-title">
        <header>
          <h2 id="observatory-timeline-title">Visible timeline</h2>
          <span>{timeline.length} events</span>
        </header>
        {visibleTimeline.length === 0 ? (
          <p className="record-empty">Authorized events will appear here in delivery order.</p>
        ) : (
          <ol>
            {visibleTimeline.map((item) => (
              <li key={`${item.deliverySequence}:${item.eventId}`}>
                <span>{item.deliverySequence}</span>
                <div><strong>{item.label}</strong><small>{item.participantId ?? "controller"}</small></div>
              </li>
            ))}
          </ol>
        )}
      </section>
    </aside>
  );
}
