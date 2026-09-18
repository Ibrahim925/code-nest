import { useMemo, useState } from "react";

import type { ReplayBundle } from "@code-nest/protocol";

import { ActivityFeed } from "../observatory/ActivityFeed.js";
import { AgentLanes } from "../observatory/AgentLanes.js";
import { EvidenceInspector } from "../observatory/EvidenceInspector.js";
import { TownHall } from "../town-hall/TownHall.js";
import { projectPortableReplay } from "./application/project-portable-replay.js";
import { BundleArtifactClient } from "./http/bundle-artifact-client.js";
import { ReplayAnalysis } from "./ReplayAnalysis.js";
import { ReplayTimeline } from "./ReplayTimeline.js";

export function ReplayViewer({
  bundle,
  onClose,
}: {
  readonly bundle: ReplayBundle;
  readonly onClose: () => void;
}): React.JSX.Element {
  const [cursor, setCursor] = useState(bundle.deliveries.length);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const view = useMemo(() => projectPortableReplay(bundle, cursor), [bundle, cursor]);
  const artifactClient = useMemo(() => new BundleArtifactClient(bundle), [bundle]);
  const selected = view.activity.items.find(({ id }) => id === selectedItemId) ?? null;
  const activityForEvent = (eventId: string) =>
    view.activity.items.find((item) => item.eventId === eventId);

  return (
    <div className="observatory-shell replay-shell">
      <header className="observatory-topbar">
        <span className="wordmark">
          <span className="wordmark-mark" aria-hidden="true"><i /><i /><i /><i /></span>
          <span>Code Nest</span>
        </span>
        <button type="button" className="replay-close" onClick={onClose}>Close replay</button>
      </header>
      <main className="replay-layout">
        <section className="replay-hero" aria-labelledby="replay-title">
          <div>
            <p className="section-kicker">Offline deterministic replay</p>
            <h1 id="replay-title">{bundle.runId}</h1>
            <p>
              {view.analysis.perspective.mode.replaceAll("_", " ")} ·
              {" "}{view.analysis.perspective.benchmarkEligible
                ? "Benchmark eligible"
                : "Benchmark ineligible"}
            </p>
          </div>
          <dl>
            <div><dt>State</dt><dd>{view.analysis.status.replaceAll("_", " ")}</dd></div>
            <div><dt>Projector</dt><dd>{bundle.projectorVersion}</dd></div>
            <div><dt>Evidence</dt><dd>{bundle.artifacts.length} embedded</dd></div>
          </dl>
        </section>

        <section className="replay-scrubber" aria-labelledby="replay-position-title">
          <div>
            <strong id="replay-position-title">Timeline position</strong>
            <span>{cursor} / {bundle.deliveries.length} visible events</span>
          </div>
          <input
            aria-label="Replay timeline position"
            type="range"
            min="0"
            max={bundle.deliveries.length}
            value={cursor}
            onChange={(event) => {
              setCursor(Number(event.currentTarget.value));
              setSelectedItemId(null);
            }}
          />
          <div>
            <button type="button" disabled={cursor === 0} onClick={() => setCursor(cursor - 1)}>
              Previous event
            </button>
            <button
              type="button"
              disabled={cursor === bundle.deliveries.length}
              onClick={() => setCursor(cursor + 1)}
            >Next event</button>
          </div>
        </section>

        <AgentLanes state={view.lanes} />
        <ReplayTimeline analysis={view.analysis} />
        <div className="observatory-workspace">
          <div className="observatory-primary">
            <TownHall
              state={view.townHall}
              canInspectCitation={(eventId) => activityForEvent(eventId) !== undefined}
              onInspectCitation={(eventId) => {
                const item = activityForEvent(eventId);
                if (item !== undefined) setSelectedItemId(item.id);
              }}
            />
            <ActivityFeed
              state={view.activity}
              participantIds={view.lanes.lanes.map(({ participantId }) => participantId)}
              selectedItemId={selectedItemId}
              onSelect={(item) => setSelectedItemId(item.id)}
            />
          </div>
          <EvidenceInspector
            runId={bundle.runId}
            selected={selected}
            artifactClient={artifactClient}
          />
        </div>
        <ReplayAnalysis analysis={view.analysis} />
      </main>
    </div>
  );
}
