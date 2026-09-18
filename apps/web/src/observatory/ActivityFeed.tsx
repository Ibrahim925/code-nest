import { useMemo, useState } from "react";

import type {
  ActivityFeedState,
  ActivityItem,
} from "./domain/activity-feed.js";

export interface ActivityFeedProps {
  readonly state: ActivityFeedState;
  readonly participantIds: readonly string[];
  readonly selectedItemId?: string | null;
  readonly onSelect?: (item: ActivityItem) => void;
}

type FeedView = "chronology" | "lanes";

function actorLabel(item: ActivityItem): string {
  return item.participantId ?? "controller";
}

function contextLabel(item: ActivityItem): string {
  const phase = item.phase?.replaceAll("_", " ");
  if (phase === undefined) return "Run event";
  return `${item.round === null ? "Run" : `Round ${item.round}`} · ${phase}`;
}

function ActivityCard({
  item,
  selected,
  onSelect,
}: {
  readonly item: ActivityItem;
  readonly selected: boolean;
  readonly onSelect: ((item: ActivityItem) => void) | undefined;
}): React.JSX.Element {
  const body = item.body;
  return (
    <article className={`activity-card category-${item.category} ${selected ? "is-selected" : ""}`}>
      <header>
        <div>
          <span className="activity-category">{item.category.replaceAll("_", " ")}</span>
          <h3>{item.title}</h3>
        </div>
        <span className={`verification is-${item.verification.replaceAll(" ", "-")}`}>
          {item.verification}
        </span>
      </header>
      <p className="activity-context">
        <strong>{actorLabel(item)}</strong> · {contextLabel(item)} · {item.eventId}
      </p>
      {body !== null && (item.category === "terminal" || item.category === "command" ? (
        <pre className="activity-code">{body.text}</pre>
      ) : (
        <p className="activity-body">{body.text}</p>
      ))}
      {body?.truncated === true && (
        <p className="truncation-note">
          {item.category === "terminal" ? "Bounded tail shown" : "Bounded preview shown"}
        </p>
      )}
      <footer>
        <span>{item.provenance}</span>
        {Object.keys(item.resourceCost).length > 0 && (
          <span>{Object.entries(item.resourceCost).map(([name, amount]) =>
            `${name} ${amount}`).join(" · ")}</span>
        )}
      </footer>
      {item.artifacts.length > 0 && (
        <details className="artifact-list">
          <summary>{item.artifacts.length} stored artifact{item.artifacts.length === 1 ? "" : "s"}</summary>
          {item.artifacts.map(({ digest }) => (
            <div key={digest}>
              <code>{digest}</code>
              <span>Preview disabled · load on demand</span>
            </div>
          ))}
        </details>
      )}
      {onSelect !== undefined && (
        <button
          className="inspect-activity"
          type="button"
          aria-pressed={selected}
          onClick={() => onSelect(item)}
        >Inspect exact evidence</button>
      )}
    </article>
  );
}

function EmptyFeed(): React.JSX.Element {
  return (
    <div className="empty-feed">
      <strong>No observable work yet</strong>
      <p>Authorized commands, notes, changes, tests, messages, usage, and artifacts appear here.</p>
    </div>
  );
}

export function ActivityFeed({
  state,
  participantIds,
  selectedItemId = null,
  onSelect,
}: ActivityFeedProps): React.JSX.Element {
  const [view, setView] = useState<FeedView>("chronology");
  const [participant, setParticipant] = useState("all");
  const filtered = useMemo(
    () => participant === "all"
      ? state.items
      : state.items.filter(({ participantId }) => participantId === participant),
    [participant, state.items],
  );

  return (
    <section className="activity-feed" aria-labelledby="activity-feed-title">
      <header className="feed-heading">
        <div>
          <p className="section-kicker">Authorized observable evidence</p>
          <h2 id="activity-feed-title">Workstream</h2>
        </div>
        <div className="feed-tools">
          <label>
            Participant
            <select value={participant} onChange={(event) => setParticipant(event.target.value)}>
              <option value="all">All actors</option>
              {participantIds.map((id) => <option value={id} key={id}>{id}</option>)}
            </select>
          </label>
          <div className="view-switch" role="group" aria-label="Workstream view">
            <button
              type="button"
              aria-pressed={view === "chronology"}
              onClick={() => setView("chronology")}
            >Chronology</button>
            <button
              type="button"
              aria-pressed={view === "lanes"}
              onClick={() => setView("lanes")}
            >Per agent</button>
          </div>
        </div>
      </header>

      {filtered.length === 0 ? <EmptyFeed /> : view === "chronology" ? (
        <div className="chronology-feed">
          {filtered.map((item) => (
            <ActivityCard
              item={item}
              selected={item.id === selectedItemId}
              onSelect={onSelect}
              key={item.id}
            />
          ))}
        </div>
      ) : (
        <div className="per-agent-feed">
          {participantIds.map((id) => (
            <section key={id} aria-labelledby={`feed-${id}`}>
              <h3 id={`feed-${id}`}>{id}</h3>
              {filtered.filter(({ participantId }) => participantId === id).map((item) => (
                <ActivityCard
                  item={item}
                  selected={item.id === selectedItemId}
                  onSelect={onSelect}
                  key={item.id}
                />
              ))}
            </section>
          ))}
        </div>
      )}
    </section>
  );
}
