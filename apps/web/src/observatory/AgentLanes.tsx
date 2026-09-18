import type { AgentLaneState } from "./domain/agent-lane.js";

export interface AgentLanesProps {
  readonly state: AgentLaneState;
}

function phaseLabel(round: number | null, phase: string | null): string {
  if (phase === null) return "Awaiting phase";
  return `${round === null ? "Run" : `Round ${round}`} · ${phase.replaceAll("_", " ")}`;
}

export function AgentLanes({ state }: AgentLanesProps): React.JSX.Element {
  return (
    <section className="agent-lanes" aria-labelledby="agent-lanes-title">
      <header className="lane-section-heading">
        <div>
          <p className="section-kicker">Concurrent runtime pulse</p>
          <h2 id="agent-lanes-title">Four participant lanes</h2>
        </div>
        <p>{state.lastDeliverySequence === 0
          ? "Waiting for the first authorized event"
          : `Visible delivery ${state.lastDeliverySequence}`}</p>
      </header>

      <div className="lane-grid" role="list" aria-label="Participant runtime lanes">
        {state.lanes.map((lane) => (
          <article className="agent-lane" role="listitem" key={lane.participantId}>
            <header className="lane-heading">
              <span className="lane-slot" aria-hidden="true">
                {String.fromCharCode(64 + lane.slot)}
              </span>
              <div>
                <h3>{lane.participantId}</h3>
                <p>{phaseLabel(lane.phase.round, lane.phase.name)}</p>
              </div>
              <span className={`activity-mark is-${lane.activity.replaceAll(" ", "-").toLowerCase()}`}>
                {lane.activity}
              </span>
            </header>

            <dl className="lane-facts">
              <div>
                <dt>Assignment</dt>
                <dd>{lane.assignmentId ?? "Awaiting briefing"}</dd>
              </div>
              <div>
                <dt>Runtime</dt>
                <dd>{lane.runtime === null
                  ? `${lane.adapterId} · ${lane.executionMode}`
                  : `${lane.runtime.runtimeName} · ${lane.runtime.executionMode}`}</dd>
              </div>
              <div>
                <dt>Model disclosure</dt>
                <dd>{lane.runtime?.modelName ?? lane.modelDisclosure}</dd>
              </div>
              <div>
                <dt>Container health</dt>
                <dd className={lane.containerHealth.availability === "unavailable" ? "unavailable-fact" : "reported-fact"}>
                  <span aria-hidden="true">{lane.containerHealth.availability === "unavailable" ? "—" : "●"}</span>{" "}
                  {lane.containerHealth.label}
                </dd>
              </div>
              <div>
                <dt>Observability</dt>
                <dd>{lane.runtime === null
                  ? "Capabilities pending"
                  : `Tier ${lane.runtime.observabilityTier} · ${lane.runtime.capabilities.length} capabilities`}</dd>
              </div>
              <div>
                <dt>Latest commit</dt>
                <dd className="monospace-fact">{lane.latestCommit ?? "None reported"}</dd>
              </div>
            </dl>

            <footer className="lane-activity-source">
              <span>Current observable activity</span>
              <strong>{lane.activity}</strong>
              <small>{lane.activityEventId === null
                ? "Initial run state"
                : `Caused by ${lane.activityEventId}`}</small>
            </footer>
          </article>
        ))}
      </div>
    </section>
  );
}
