import type { ArtifactEvidenceClient } from "../evidence/domain/artifact-evidence.js";
import { AgentComputer } from "./AgentComputer.js";
import { ObservatoryDiscourse } from "./ObservatoryDiscourse.js";
import type { AgentObservatoryState } from "./domain/agent-observatory.js";
import type { AgentLaneState } from "./domain/agent-lane.js";

export interface AgentObservatoryProps {
  readonly runId: string;
  readonly state: AgentObservatoryState;
  readonly laneState: AgentLaneState;
  readonly artifactClient: ArtifactEvidenceClient;
}

function phaseName(name: string | null): string {
  return name?.replaceAll("_", " ") ?? "Awaiting first phase";
}

export function AgentObservatory({
  runId,
  state,
  laneState,
  artifactClient,
}: AgentObservatoryProps): React.JSX.Element {
  const phase = phaseName(state.phase.name);
  return (
    <section className="agent-observatory" aria-labelledby="agent-observatory-title">
      <header className="observatory-phase-banner">
        <div>
          <h2 id="agent-observatory-title">Four-agent live workspace</h2>
          <p>Only authorized human-view facts are shown. Private reasoning is never projected.</p>
        </div>
        <div className="phase-readout" aria-label={`Current phase: ${phase}`}>
          <span>{state.phase.round === null ? "Run" : `Round ${state.phase.round}`}</span>
          <strong>{phase}</strong>
          <small>{state.phase.transitionCount === 0
            ? "Waiting for first transition"
            : `${state.phase.transitionCount} phase transitions`}</small>
        </div>
      </header>

      <div className="agent-observatory-layout">
        <div className="agent-computer-grid" role="list" aria-label="Four participant computers">
          {state.agents.map((agent) => (
            <AgentComputer
              key={agent.participantId}
              runId={runId}
              agent={agent}
              lane={laneState.lanes.find(({ participantId }) =>
                participantId === agent.participantId)}
              artifactClient={artifactClient}
            />
          ))}
        </div>
        <ObservatoryDiscourse discourse={state.discourse} timeline={state.timeline} />
      </div>
    </section>
  );
}
