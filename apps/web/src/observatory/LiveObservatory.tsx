import { useEffect, useMemo, useState } from "react";

import { createLiveEventClient } from "../events/create-live-event-client.js";
import type { LiveConnectionState } from "../events/domain/live-events.js";
import type { RunMutation } from "../run-setup/client.js";
import type { RunControlView, RunSetupConfiguration } from "../run-setup/domain.js";
import { RunControls } from "../run-setup/RunControls.js";
import { AgentLanes } from "./AgentLanes.js";
import {
  createAgentLaneState,
  projectAgentLanes,
} from "./application/project-agent-lanes.js";

export interface LiveObservatoryProps {
  readonly baseUrl: string;
  readonly bearerToken: string;
  readonly configuration: RunSetupConfiguration;
  readonly run: RunControlView;
  readonly pendingAction: RunMutation | null;
  readonly controlError: string | null;
  readonly onMutation: (action: RunMutation) => void;
}

function connectionLabel(state: LiveConnectionState): string {
  switch (state.status) {
    case "connecting": return "Connecting";
    case "live": return "Following live";
    case "recovering": return `Recovering · attempt ${state.attempt}`;
    case "failed": return `Connection failed · ${state.code}`;
    case "stopped": return "Stream stopped";
  }
}

export function LiveObservatory({
  baseUrl,
  bearerToken,
  configuration,
  run,
  pendingAction,
  controlError,
  onMutation,
}: LiveObservatoryProps): React.JSX.Element {
  const participantSeeds = useMemo(
    () => configuration.adapters.map((adapter) => ({ ...adapter })),
    [configuration.adapters],
  );
  const [lanes, setLanes] = useState(() => createAgentLaneState(participantSeeds));
  const [connection, setConnection] = useState<LiveConnectionState>({
    status: "connecting",
    attempt: 1,
    lastEventId: null,
  });

  useEffect(() => {
    const cancellation = new AbortController();
    setLanes(createAgentLaneState(participantSeeds));
    const client = createLiveEventClient({ baseUrl });
    void client.follow(
      { runId: run.runId, bearerToken, signal: cancellation.signal },
      {
        onDelivery(delivery) {
          setLanes((current) => projectAgentLanes(current, delivery));
        },
        onState: setConnection,
      },
    ).catch(() => {
      if (!cancellation.signal.aborted) {
        setConnection({
          status: "failed",
          code: "LIVE_CLIENT_FAILED",
          message: "The browser could not follow this run.",
          lastEventId: null,
        });
      }
    });
    return () => cancellation.abort();
  }, [baseUrl, bearerToken, participantSeeds, run.runId]);

  const sharedPhase = lanes.lanes[0]?.phase;
  return (
    <div className="observatory-shell">
      <header className="observatory-topbar">
        <a className="wordmark" href="#live-observatory" aria-label="Code Nest Live Observatory">
          <span className="wordmark-mark" aria-hidden="true"><i /><i /><i /><i /></span>
          <span>Code Nest</span>
        </a>
        <div className={`connection-state is-${connection.status}`} aria-live="polite">
          <span aria-hidden="true" /> {connectionLabel(connection)}
        </div>
      </header>

      <main id="live-observatory" className="observatory-layout">
        <section className="run-bar" aria-labelledby="run-bar-title">
          <div>
            <p className="section-kicker">Live Observatory</p>
            <h1 id="run-bar-title">{run.runId}</h1>
          </div>
          <dl className="run-bar-facts">
            <div><dt>Run</dt><dd>{run.status}</dd></div>
            <div><dt>Round</dt><dd>{sharedPhase?.round ?? "—"}</dd></div>
            <div><dt>Phase</dt><dd>{sharedPhase?.name?.replaceAll("_", " ") ?? "Awaiting event"}</dd></div>
            <div><dt>Constitution</dt><dd>{configuration.constitution.replaceAll("-", " ")}</dd></div>
          </dl>
          <div className="run-bar-controls">
            <RunControls run={run} pendingAction={pendingAction} onMutation={onMutation} />
          </div>
        </section>

        {controlError !== null && <p className="request-error" role="alert">{controlError}</p>}
        <AgentLanes state={lanes} />

        <aside className="next-surface" aria-label="Observatory scope note">
          <span>Next surface</span>
          <p>Observable commands, files, tests, messages, and artifacts join these stable lanes in CN-030.</p>
        </aside>
      </main>
    </div>
  );
}
