import { useEffect, useMemo, useState } from "react";

import { createLiveEventClient } from "../events/create-live-event-client.js";
import type { LiveConnectionState } from "../events/domain/live-events.js";
import { FetchArtifactClient } from "../evidence/http/fetch-artifact-client.js";
import { projectObserverMode } from "../observer/application/project-observer-mode.js";
import { initialObserverMode } from "../observer/domain/modes.js";
import { HttpObserverModeClient } from "../observer/http/observer-mode-client.js";
import { ObserverModePanel } from "../observer/ObserverModePanel.js";
import { createFrameBatcher } from "../quality/application/frame-batcher.js";
import { animationFrameScheduler } from "../quality/browser/animation-frame-scheduler.js";
import {
  createDeliveryLatencyState,
  deliveryLatencyLabel,
  projectDeliveryLatency,
} from "../quality/domain/delivery-latency.js";
import type { DecodedEventDelivery } from "../events/domain/live-events.js";
import { ReplayExportPanel } from "../replay/ReplayExportPanel.js";
import { HttpReplayClient } from "../replay/http/replay-client.js";
import type { RunMutation } from "../run-setup/client.js";
import type { RunControlView, RunSetupConfiguration } from "../run-setup/domain.js";
import { RunControls } from "../run-setup/RunControls.js";
import { projectTownHall } from "../town-hall/application/project-town-hall.js";
import { createTownHallViewState } from "../town-hall/domain/town-hall.js";
import { TownHall } from "../town-hall/TownHall.js";
import { AgentObservatory } from "./AgentObservatory.js";
import { ActivityFeed } from "./ActivityFeed.js";
import { EvidenceInspector } from "./EvidenceInspector.js";
import {
  createAgentLaneState,
  projectAgentLanes,
} from "./application/project-agent-lanes.js";
import {
  createAgentObservatoryState,
  projectAgentObservatory,
} from "./application/project-agent-observatory.js";
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

interface ReceivedDelivery {
  readonly delivery: DecodedEventDelivery;
  readonly receivedAtEpochMilliseconds: number;
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
  const [agentObservatory, setAgentObservatory] = useState(() =>
    createAgentObservatoryState(participantSeeds)
  );
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
  const [deliveryLatency, setDeliveryLatency] = useState(createDeliveryLatencyState);
  const artifactClient = useMemo(
    () => new FetchArtifactClient({ baseUrl, bearerToken }),
    [baseUrl, bearerToken],
  );
  const observerClient = useMemo(
    () => new HttpObserverModeClient({ baseUrl, token: bearerToken }),
    [baseUrl, bearerToken],
  );
  const replayClient = useMemo(
    () => new HttpReplayClient({ baseUrl, bearerToken }),
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
    setAgentObservatory(createAgentObservatoryState(participantSeeds));
    setActivity(createActivityFeedState());
    setTownHall(createTownHallViewState());
    setDeliveryLatency(createDeliveryLatencyState());
    setSelectedItemId(null);
    const client = createLiveEventClient({ baseUrl });
    const batcher = createFrameBatcher<ReceivedDelivery>(
      animationFrameScheduler,
      (batch) => {
        const deliveries = batch.map(({ delivery }) => delivery);
        setLanes((current) => deliveries.reduce(projectAgentLanes, current));
        setAgentObservatory((current) =>
          deliveries.reduce(projectAgentObservatory, current)
        );
        setActivity((current) => deliveries.reduce(projectActivityFeed, current));
        setTownHall((current) => deliveries.reduce(projectTownHall, current));
        setObserverMode((current) => deliveries.reduce(projectObserverMode, current));
        setDeliveryLatency((current) => batch.reduce(
          (state, received) => projectDeliveryLatency(
            state,
            received.delivery,
            received.receivedAtEpochMilliseconds,
          ),
          current,
        ));
      },
    );
    void client.follow(
      { runId: run.runId, bearerToken, signal: cancellation.signal },
      {
        onDelivery(delivery) {
          batcher.push({ delivery, receivedAtEpochMilliseconds: Date.now() });
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
    return () => {
      batcher.stop();
      cancellation.abort();
    };
  }, [baseUrl, bearerToken, observerClient, participantSeeds, projectionEpoch, run.runId]);

  const lanePhase = lanes.lanes[0]?.phase;
  const sharedPhase = agentObservatory.phase.name === null
    ? lanePhase
    : agentObservatory.phase;
  const phaseAnnouncement = sharedPhase?.name === null || sharedPhase?.name === undefined
    ? "Match phase awaiting the first authorized event."
    : `Match phase changed to round ${sharedPhase.round ?? "run"}, ${sharedPhase.name.replaceAll("_", " ")}.`;
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
          <span className="connection-indicator" aria-hidden="true" />
          <span>{connectionLabel(connection)}</span>
          <small>{deliveryLatencyLabel(deliveryLatency)}</small>
        </div>
      </header>

      <main id="live-observatory" className="observatory-layout">
        <p className="sr-only" aria-live="polite" aria-atomic="true">
          {phaseAnnouncement}
        </p>
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

        <ReplayExportPanel
          runId={run.runId}
          ready={
            run.status === "cancelled" ||
            lanes.lanes.every(({ activity: laneActivity }) => laneActivity === "finished")
          }
          client={replayClient}
        />

        {controlError !== null && <p className="request-error" role="alert">{controlError}</p>}
        <AgentObservatory
          runId={run.runId}
          state={agentObservatory}
          laneState={lanes}
          artifactClient={artifactClient}
        />
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
