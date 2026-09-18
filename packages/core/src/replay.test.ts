import type { EventDelivery, ReplayBundle } from "@code-nest/protocol";
import { describe, expect, it } from "vitest";

import { projectReplay } from "./replay.js";

function delivery(
  deliverySequence: number,
  kind: string,
  payload: EventDelivery["event"]["payload"],
  options: {
    visibility?: EventDelivery["event"]["visibility"];
    resourceCost?: Record<string, number>;
  } = {},
): EventDelivery {
  return {
    deliveryVersion: "1.0",
    deliverySequence,
    event: {
      schemaVersion: "1.0",
      eventId: `event-${deliverySequence}`,
      runId: "run-replay",
      recordedAt: `2026-09-18T10:00:0${deliverySequence}.000Z`,
      actor: { kind: "controller", id: "controller" },
      context: { round: deliverySequence === 1 ? null : 3, phase: deliverySequence === 1 ? null : "completion" },
      kind,
      payload,
      visibility: options.visibility ?? { class: "public" },
      causationId: `command-${deliverySequence}`,
      correlationId: "run-replay",
      parentEventIds: [],
      artifactDigests: [],
      resourceCost: options.resourceCost ?? {},
    },
  };
}

function revealedBundle(): ReplayBundle {
  const deliveries = [
    delivery(1, "run.created", { action: "create" }),
    delivery(2, "belief.reported", {
      schemaVersion: "1.0",
      participantId: "player-a",
      round: 3,
      allocations: [
        { participantId: "player-b", points: 20 },
        { participantId: "player-c", points: 30 },
        { participantId: "player-d", points: 50 },
      ],
      strongestEvidenceEventId: "evidence-1",
    }, { visibility: { class: "participant_private", recipientIds: ["player-a"] } }),
    delivery(3, "match.roles_revealed", {
      roles: [
        { participantId: "player-a", assignmentId: "one", role: "builder" },
        { participantId: "player-b", assignmentId: "two", role: "saboteur" },
        { participantId: "player-c", assignmentId: "three", role: "builder" },
        { participantId: "player-d", assignmentId: "four", role: "builder" },
      ],
    }, { visibility: { class: "post_reveal" } }),
    delivery(4, "match.scoreboard_published", {
      teamScore: 137.3,
      saboteurScore: 40,
    }, { visibility: { class: "post_reveal" }, resourceCost: { governanceCredits: 2 } }),
    delivery(5, "match.completed", { roundsCompleted: 3 }, {
      resourceCost: { governanceCredits: 1, elapsedMilliseconds: 500 },
    }),
  ];
  return {
    schemaVersion: "1.0",
    projectorVersion: "1.0",
    runId: "run-replay",
    terminal: { kind: "completed", eventId: "event-5" },
    perspective: { mode: "post_match_reveal", benchmarkEligible: true },
    deliveries,
    artifacts: [],
  };
}

describe("portable replay projection", () => {
  it("reconstructs reveal, belief calibration, score data, and resource metrics", () => {
    const projection = projectReplay(revealedBundle());

    expect(projection.status).toBe("completed");
    expect(projection.revealedRoles["player-b"]).toBe("saboteur");
    expect(projection.beliefs).toEqual([
      expect.objectContaining({ participantId: "player-a", brierScore: 0.98 }),
    ]);
    expect(projection.metrics).toMatchObject({
      visibleEventCount: 5,
      artifactCount: 0,
      totalResourceCost: { elapsedMilliseconds: 500, governanceCredits: 3 },
      beliefCalibrationMean: 0.98,
      scoreboard: { teamScore: 137.3, saboteurScore: 40 },
    });
  });

  it("rebuilds an earlier synchronized state without using future reveal facts", () => {
    const projection = projectReplay(revealedBundle(), 2);

    expect(projection.status).toBe("in_progress");
    expect(projection.timeline.map(({ eventId }) => eventId)).toEqual(["event-1", "event-2"]);
    expect(projection.revealedRoles).toEqual({});
    expect(projection.beliefs[0]?.brierScore).toBeNull();
    expect(projection.metrics.scoreboard).toBeNull();
  });

  it("produces identical projections from the same bundle", () => {
    const bundle = revealedBundle();
    expect(projectReplay(bundle)).toEqual(projectReplay(structuredClone(bundle)));
  });

  it("rejects a cursor outside the portable timeline", () => {
    expect(() => projectReplay(revealedBundle(), 6)).toThrow("outside");
  });
});
