import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { ReplayTimelineItem } from "@code-nest/core";

import type { DecodedEventDelivery } from "../events/domain/live-events.js";
import { ActivityFeed } from "../observatory/ActivityFeed.js";
import {
  createActivityFeedState,
  projectActivityFeed,
} from "../observatory/application/project-activity-feed.js";
import { ReplayTimeline } from "../replay/ReplayTimeline.js";
import { createFrameBatcher } from "./application/frame-batcher.js";
import {
  createDeliveryLatencyState,
  deliveryOnTimeRatio,
  projectDeliveryLatency,
} from "./domain/delivery-latency.js";
import { projectEventWindow } from "./domain/event-window.js";

const PARTICIPANTS = ["player-a", "player-b", "player-c", "player-d"] as const;
const RECORDED_AT = Date.parse("2026-09-18T12:00:00.000Z");

function terminalDelivery(sequence: number): DecodedEventDelivery {
  const participantId = PARTICIPANTS[(sequence - 1) % PARTICIPANTS.length] ?? "player-a";
  const eventId = `scale-${sequence}`;
  return {
    deliverySequence: sequence,
    eventId,
    kind: "runtime.terminal_output",
    event: {
      eventId,
      recordedAt: new Date(RECORDED_AT + sequence).toISOString(),
      actor: { kind: "participant", id: participantId },
      context: { round: 2, phase: "work" },
      kind: "runtime.terminal_output",
      payload: { participantId, stream: "stdout", text: `bounded output ${sequence}` },
      visibility: { class: "public" },
      artifactDigests: [],
      resourceCost: {},
    },
  };
}

function timeline(count: number): readonly ReplayTimelineItem[] {
  return Array.from({ length: count }, (_, index) => {
    const sequence = index + 1;
    return {
      deliverySequence: sequence,
      eventId: `timeline-${sequence}`,
      kind: "runtime.terminal_output",
      recordedAt: new Date(RECORDED_AT + sequence).toISOString(),
      actorId: PARTICIPANTS[index % PARTICIPANTS.length] ?? "player-a",
      round: 2,
      phase: "work",
      artifactDigests: [],
    };
  });
}

describe("10,000-event Observatory scale", () => {
  it("batches cosmetic work once per frame without changing delivery order", () => {
    let scheduled: (() => void) | null = null;
    const consumed: number[][] = [];
    const batcher = createFrameBatcher<number>({
      request(work) {
        scheduled = work;
        return () => {
          scheduled = null;
        };
      },
    }, (items) => consumed.push([...items]));

    for (let sequence = 1; sequence <= 10_000; sequence += 1) batcher.push(sequence);
    expect(consumed).toEqual([]);
    expect(scheduled).not.toBeNull();
    const flush = scheduled as unknown as () => void;
    flush();
    expect(consumed).toHaveLength(1);
    expect(consumed[0]?.[0]).toBe(1);
    expect(consumed[0]?.at(-1)).toBe(10_000);
  });

  it("projects four concurrent terminal streams above 200 events per second", () => {
    let state = createActivityFeedState();
    const startedAt = performance.now();
    for (let sequence = 1; sequence <= 10_000; sequence += 1) {
      state = projectActivityFeed(state, terminalDelivery(sequence));
    }
    const elapsedSeconds = Math.max((performance.now() - startedAt) / 1_000, 0.001);

    expect(state.items).toHaveLength(10_000);
    expect(new Set(state.items.map(({ participantId }) => participantId))).toEqual(
      new Set(PARTICIPANTS),
    );
    expect(10_000 / elapsedSeconds).toBeGreaterThanOrEqual(200);
  });

  it("renders bounded keyboard-navigable live and replay windows", () => {
    let activity = createActivityFeedState();
    for (let sequence = 1; sequence <= 10_000; sequence += 1) {
      activity = projectActivityFeed(activity, terminalDelivery(sequence));
    }
    const startedAt = performance.now();
    const liveMarkup = renderToStaticMarkup(createElement(ActivityFeed, {
      state: activity,
      participantIds: PARTICIPANTS,
    }));
    const replayMarkup = renderToStaticMarkup(createElement(ReplayTimeline, {
      analysis: { timeline: timeline(10_000) },
    }));
    const elapsedMilliseconds = performance.now() - startedAt;

    expect(liveMarkup.match(/class="activity-card/g)).toHaveLength(80);
    expect(replayMarkup.match(/<li/g)).toHaveLength(80);
    expect(liveMarkup).toContain("Events 9921–10000 of 10000");
    expect(replayMarkup).toContain("Replay timeline event navigation");
    expect(liveMarkup).toContain("Older events");
    expect(liveMarkup.length + replayMarkup.length).toBeLessThan(300_000);
    expect(elapsedMilliseconds).toBeLessThan(2_000);
  });

  it("tracks the two-second delivery objective without retaining payloads", () => {
    let latency = createDeliveryLatencyState();
    for (let sequence = 1; sequence <= 1_000; sequence += 1) {
      const delivery = terminalDelivery(sequence);
      const recordedAt = Date.parse(
        (delivery.event as { recordedAt: string }).recordedAt,
      );
      latency = projectDeliveryLatency(
        latency,
        delivery,
        recordedAt + (sequence <= 950 ? 1_999 : 2_001),
      );
    }

    expect(deliveryOnTimeRatio(latency)).toBe(0.95);
    expect(latency).toMatchObject({
      measuredCount: 1_000,
      onTimeCount: 950,
      delayedCount: 50,
      lastDeliverySequence: 1_000,
    });
    expect(Object.keys(latency)).not.toContain("deliveries");
  });

  it("keeps event-window boundaries deterministic", () => {
    const first = projectEventWindow(timeline(10_000), 80);
    const last = projectEventWindow(timeline(10_000));
    expect(first).toMatchObject({ start: 0, end: 80, hiddenAfter: 9_920 });
    expect(last).toMatchObject({ start: 9_920, end: 10_000, hiddenBefore: 9_920 });
    expect(() => projectEventWindow([], 0, 201)).toThrow("between 1 and 200");
  });
});
