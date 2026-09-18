import { readFileSync } from "node:fs";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ActivityFeed } from "../observatory/ActivityFeed.js";
import { AgentLanes } from "../observatory/AgentLanes.js";
import { LiveObservatory } from "../observatory/LiveObservatory.js";
import { createActivityFeedState } from "../observatory/application/project-activity-feed.js";
import { createAgentLaneState } from "../observatory/application/project-agent-lanes.js";
import { ReplayTimeline } from "../replay/ReplayTimeline.js";
import { DEFAULT_RUN_SETUP } from "../run-setup/catalog.js";

const run = {
  schemaVersion: "1.0" as const,
  runId: "accessibility-run",
  status: "running" as const,
  terminalReason: null,
  createdAt: "2026-09-18T12:00:00.000Z",
  updatedAt: "2026-09-18T12:00:00.000Z",
  lastEventSequence: 0,
};

describe("core Observatory accessibility", () => {
  it("names landmarks, status, phase announcements, and every operator control", () => {
    const markup = renderToStaticMarkup(
      <LiveObservatory
        baseUrl="/api"
        bearerToken="not-rendered"
        configuration={DEFAULT_RUN_SETUP}
        run={run}
        pendingAction={null}
        controlError={null}
        onMutation={() => undefined}
      />,
    );

    expect(markup).toContain("<main");
    expect(markup).toContain("Code Nest Live Observatory");
    expect(markup).toContain('aria-live="polite"');
    expect(markup).toContain("Match phase awaiting the first authorized event");
    expect(markup).toContain("Delivery timing awaiting first event");
    expect(markup).toContain("Pause");
    expect(markup).toContain("Cancel run");
    expect(markup).not.toContain("not-rendered");
  });

  it("uses textual lane status and keeps live terminal content outside announcements", () => {
    const laneMarkup = renderToStaticMarkup(
      <AgentLanes state={createAgentLaneState(DEFAULT_RUN_SETUP.adapters)} />,
    );
    const feedMarkup = renderToStaticMarkup(
      <ActivityFeed
        state={createActivityFeedState()}
        participantIds={DEFAULT_RUN_SETUP.adapters.map(({ participantId }) => participantId)}
      />,
    );

    expect(laneMarkup.match(/role="listitem"/g)).toHaveLength(4);
    expect(laneMarkup).toContain("Not reported");
    expect(laneMarkup).toContain("Awaiting briefing");
    expect(feedMarkup).toContain('aria-label="Workstream view"');
    expect(feedMarkup).not.toContain('role="log"');
    expect(feedMarkup).not.toContain('aria-live="assertive"');
  });

  it("makes replay chronology operable without pointer input", () => {
    const timeline = Array.from({ length: 81 }, (_, index) => ({
      deliverySequence: index + 1,
      eventId: `event-${index + 1}`,
      kind: "phase.started",
      recordedAt: "2026-09-18T12:00:00.000Z",
      actorId: "controller",
      round: 1,
      phase: "work",
      artifactDigests: [],
    }));
    const markup = renderToStaticMarkup(<ReplayTimeline analysis={{ timeline }} />);

    expect(markup).toContain('aria-label="Replay timeline event navigation"');
    expect(markup).toContain("Older events");
    expect(markup).toContain("Newer events");
    expect(markup).toContain('aria-live="polite"');
  });

  it("provides visible focus and removes non-essential motion", () => {
    const globalStyles = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
    expect(globalStyles).toContain(":focus-visible");
    expect(globalStyles).toContain("outline: 3px solid");
    expect(globalStyles).toContain("prefers-reduced-motion: reduce");
    expect(globalStyles).toContain("scroll-behavior: auto");
    expect(globalStyles).toContain("animation-duration: 0.01ms !important");
  });
});
