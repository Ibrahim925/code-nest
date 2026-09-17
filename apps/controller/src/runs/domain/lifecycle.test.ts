import { describe, expect, it } from "vitest";

import {
  applyRunEvent,
  foldRunEvents,
  RunHistoryError,
  type RunAction,
  type RunLifecycleEvent,
} from "./lifecycle";

function event(
  action: RunAction,
  sequence: number,
  runId = "run-001",
): RunLifecycleEvent {
  return {
    eventId: `event-${sequence}`,
    runId,
    sequence,
    recordedAt: `2026-09-17T16:00:0${sequence}.000Z`,
    action,
  };
}

describe("run lifecycle domain", () => {
  it("folds the permitted lifecycle into an explicit terminal reason", () => {
    const state = foldRunEvents([
      event("create", 1),
      event("pause", 2),
      event("resume", 3),
      event("cancel", 4),
    ]);

    expect(state).toMatchObject({
      runId: "run-001",
      status: "cancelled",
      terminalReason: "operator_cancelled",
      lastEventSequence: 4,
    });
  });

  it("requires creation to be the first lifecycle event", () => {
    expect(() => applyRunEvent(undefined, event("pause", 1))).toThrow(
      RunHistoryError,
    );
    expect(() => applyRunEvent(undefined, event("create", 2))).toThrow(
      RunHistoryError,
    );
  });

  it("rejects duplicate and cross-run transitions during replay", () => {
    const running = applyRunEvent(undefined, event("create", 1));

    expect(() => applyRunEvent(running, event("resume", 2))).toThrow(
      RunHistoryError,
    );
    expect(() =>
      applyRunEvent(running, event("pause", 2, "run-other")),
    ).toThrow(RunHistoryError);
    expect(() => applyRunEvent(running, event("pause", 1))).toThrow(
      RunHistoryError,
    );
  });
});
