import type { ArtifactEvidenceClient } from "../evidence/domain/artifact-evidence.js";
import { AgentFrameView } from "./AgentFrameView.js";
import { AgentMemory } from "./AgentMemory.js";
import type { ObservatoryAgent } from "./domain/agent-observatory.js";
import type { AgentLane } from "./domain/agent-lane.js";

export interface AgentComputerProps {
  readonly runId: string;
  readonly agent: ObservatoryAgent;
  readonly lane: AgentLane | undefined;
  readonly artifactClient: ArtifactEvidenceClient;
}

function activityLabel(agent: ObservatoryAgent): string {
  return agent.activity.state?.replaceAll("_", " ") ?? "awaiting activity";
}

export function AgentComputer({
  runId,
  agent,
  lane,
  artifactClient,
}: AgentComputerProps): React.JSX.Element {
  return (
    <article className="agent-computer agent-lane" role="listitem">
      <header className="agent-computer-heading">
        <span className="agent-computer-slot" aria-hidden="true">
          {String.fromCharCode(64 + agent.slot)}
        </span>
        <div>
          <h3>{agent.participantId}</h3>
          <p>{agent.modelDisclosure}</p>
        </div>
        <span className={`agent-activity is-${agent.activity.state ?? "awaiting"}`}>
          {activityLabel(agent)}
        </span>
      </header>

      <AgentFrameView
        runId={runId}
        participantId={agent.participantId}
        computer={agent.computer}
        artifactClient={artifactClient}
      />

      <section className="agent-live-note" aria-label={`${agent.participantId} observable activity`}>
        <div>
          <span>Observable activity</span>
          <strong>{agent.activity.summary}</strong>
        </div>
        <dl>
          <div><dt>Runtime</dt><dd>{agent.adapterId} · {agent.executionMode}</dd></div>
          <div><dt>Assignment</dt><dd>{lane?.assignmentId ?? "Awaiting briefing"}</dd></div>
          <div><dt>Container</dt><dd>{lane?.containerHealth.label ?? "Not reported"}</dd></div>
          <div><dt>Latest tool</dt><dd>{agent.latestTool === null
            ? "None observed"
            : `${agent.latestTool.toolName} · ${agent.latestTool.status}`}</dd></div>
        </dl>
      </section>

      <section className="agent-rationale" aria-label={`${agent.participantId} submitted rationale`}>
        <header>
          <h4>Submitted rationale</h4>
          <span>{agent.rationale?.attribution ?? "No submission"}</span>
        </header>
        <p>{agent.rationale?.body ?? "The agent has not submitted a rationale or provider summary."}</p>
      </section>

      <AgentMemory
        runId={runId}
        participantId={agent.participantId}
        memory={agent.memory}
        artifactClient={artifactClient}
      />
    </article>
  );
}
