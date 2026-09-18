import { describe, expect, it } from "vitest";

import {
  parseReplayBundle,
  serializeReplayBundle,
  type ReplayBundle,
} from "./replay-bundle.js";

function bundle(): ReplayBundle {
  return {
    schemaVersion: "1.0",
    projectorVersion: "1.0",
    runId: "run-1",
    terminal: { kind: "cancelled", eventId: "event-2" },
    perspective: { mode: "clean", benchmarkEligible: true },
    deliveries: [1, 2].map((sequence) => ({
      deliveryVersion: "1.0" as const,
      deliverySequence: sequence,
      event: {
        schemaVersion: "1.0" as const,
        eventId: `event-${sequence}`,
        runId: "run-1",
        recordedAt: `2026-09-18T10:00:0${sequence}.000Z`,
        actor: { kind: "operator" as const, id: "operator" },
        context: { round: null, phase: null },
        kind: sequence === 1 ? "run.created" : "run.cancelled",
        payload: sequence === 1
          ? { action: "create" }
          : { action: "cancel", terminalReason: "operator_cancelled" },
        visibility: { class: "public" as const },
        causationId: `command-${sequence}`,
        correlationId: "run-1",
        parentEventIds: [],
        artifactDigests: [],
        resourceCost: {},
      },
    })),
    artifacts: [],
  };
}

describe("replay bundle contract", () => {
  it("round-trips an exact Version 1 portable bundle", () => {
    const original = bundle();
    const serialized = serializeReplayBundle(original);
    expect(parseReplayBundle(JSON.parse(serialized))).toEqual({ ok: true, value: original });
  });

  it("rejects unsupported versions and changed structure", () => {
    expect(parseReplayBundle({ ...bundle(), schemaVersion: "2.0" })).toMatchObject({
      ok: false,
      error: { code: "UNSUPPORTED_REPLAY_BUNDLE_VERSION" },
    });
    expect(parseReplayBundle({ ...bundle(), credential: "must-not-fit" })).toMatchObject({
      ok: false,
      error: { code: "INVALID_REPLAY_BUNDLE" },
    });
  });

  it("rejects sequence gaps, cross-run events, and missing artifacts", () => {
    const original = bundle();
    const changed = {
      ...original,
      deliveries: original.deliveries.map((delivery, index) => ({
        ...delivery,
        deliverySequence: index === 1 ? 3 : delivery.deliverySequence,
        event: {
          ...delivery.event,
          runId: index === 0 ? "another-run" : delivery.event.runId,
          artifactDigests: index === 0
            ? [`sha256:${"a".repeat(64)}`]
            : delivery.event.artifactDigests,
        },
      })),
    };
    expect(parseReplayBundle(changed)).toMatchObject({
      ok: false,
      error: {
        issues: expect.arrayContaining([
          "delivery_sequence",
          "delivery_run_id",
          "missing_artifact",
        ]),
      },
    });
  });

  it("rejects inconsistent perspective and terminal claims", () => {
    expect(parseReplayBundle({
      ...bundle(),
      perspective: { mode: "unblinded", benchmarkEligible: true },
      terminal: { kind: "completed", eventId: "event-2" },
    })).toMatchObject({
      ok: false,
      error: {
        issues: expect.arrayContaining([
          "terminal_event",
          "unblinded_benchmark_eligibility",
        ]),
      },
    });
  });
});
