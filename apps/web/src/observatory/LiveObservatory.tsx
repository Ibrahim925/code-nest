import { useEffect, useMemo, useState } from "react";

import { createLiveEventClient } from "../events/create-live-event-client.js";
import type { LiveConnectionState } from "../events/domain/live-events.js";
import { FetchArtifactClient } from "../evidence/http/fetch-artifact-client.js";
import { projectObserverMode } from "../observer/application/project-observer-mode.js";
import { initialObserverMode } from "../observer/domain/modes.js";
import { HttpObserverModeClient } from "../observer/http/observer-mode-client.js";
import { ObserverModePanel } from "../observer/ObserverModePanel.js";
import type { RunMutation } from "../run-setup/client.js";
import type { RunControlView, RunSetupConfiguration } from "../run-setup/domain.js";
import { RunControls } from "../run-setup/RunControls.js";
import { projectTownHall } from "../town-hall/application/project-town-hall.js";
import { createTownHallViewState } from "../town-hall/domain/town-hall.js";
import { TownHall } from "../town-hall/TownHall.js";
import { AgentLanes } from "./AgentLanes.js";
import { ActivityFeed } from "./ActivityFeed.js";
import { EvidenceInspector } from "./EvidenceInspector.js";
import {
  createAgentLaneState,
  projectAgentLanes,
} from "./application/project-agent-lanes.js";
import {
  createActivityFeedState,
  projectActivityFeed,
} from "./application/project-activity-feed.js";

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
  const [activity, setActivity] = useState(createActivityFeedState);
  const [townHall, setTownHall] = useState(createTownHallViewState);
  const [observerMode, setObserverMode] = useState(() =>
    initialObserverMode(run.runId, configuration.disclosurePolicy)
  );
  const [projectionEpoch, setProjectionEpoch] = useState(0);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [connection, setConnection] = useState<LiveConnectionState>({
    status: "connecting",
    attempt: 1,
    lastEventId: null,
  });
  const artifactClient = useMemo(
    () => new FetchArtifactClient({ baseUrl, bearerToken }),
    [baseUrl, bearerToken],
  );
  const observerClient = useMemo(
    () => new HttpObserverModeClient({ baseUrl, token: bearerToken }),
    [baseUrl, bearerToken],
  );

  useEffect(() => {
    const cancellation = new AbortController();
    void observerClient.get(run.runId, cancellation.signal)
      .then(setObserverMode)
      .catch(() => undefined);
    return () => cancellation.abort();
  }, [observerClient, run.runId]);

  useEffect(() => {
    setProjectionEpoch((value) => value + 1);
  }, [observerMode.mode]);

  useEffect(() => {
    const cancellation = new AbortController();
    setLanes(createAgentLaneState(participantSeeds));
    setActivity(createActivityFeedState());
    setTownHall(createTownHallViewState());
    setSelectedItemId(null);
    const client = createLiveEventClient({ baseUrl });
    void client.follow(
      { runId: run.runId, bearerToken, signal: cancellation.signal },
      {
        onDelivery(delivery) {
          setLanes((current) => projectAgentLanes(current, delivery));
          setActivity((current) => projectActivityFeed(current, delivery));
          setTownHall((current) => projectTownHall(current, delivery));
          setObserverMode((current) => projectObserverMode(current, delivery));
          if (delivery.kind === "match.completed") {
            void observerClient.get(run.runId).then(setObserverMode).catch(() => undefined);
          }
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
  }, [baseUrl, bearerToken, observerClient, participantSeeds, projectionEpoch, run.runId]);

  const sharedPhase = lanes.lanes[0]?.phase;
  const selected = activity.items.find(({ id }) => id === selectedItemId) ?? null;
  const activityForEvent = (eventId: string) =>
    activity.items.find((item) => item.eventId === eventId);
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

        <ObserverModePanel
          state={observerMode}
          onUnblind={async () => {
            setObserverMode(await observerClient.unblind(run.runId));
          }}
        />

        {controlError !== null && <p className="request-error" role="alert">{controlError}</p>}
        <AgentLanes state={lanes} />
        <div className="observatory-workspace">
          <div className="observatory-primary">
            <TownHall
              state={townHall}
              canInspectCitation={(eventId) => activityForEvent(eventId) !== undefined}
              onInspectCitation={(eventId) => {
                const item = activityForEvent(eventId);
                if (item !== undefined) setSelectedItemId(item.id);
              }}
            />
            <ActivityFeed
              state={activity}
              participantIds={lanes.lanes.map(({ participantId }) => participantId)}
              selectedItemId={selectedItemId}
              onSelect={(item) => setSelectedItemId(item.id)}
            />
          </div>
          <EvidenceInspector
            runId={run.runId}
            selected={selected}
            artifactClient={artifactClient}
          />
        </div>
      </main>
    </div>
  );
}
