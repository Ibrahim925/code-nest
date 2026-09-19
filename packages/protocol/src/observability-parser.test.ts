import { describe, expect, it } from "vitest";

import { parseObservabilityEvent } from "./observability-parser.js";
import {
  activityEvent,
  baseEvent,
  frameEvent,
  participantPrivate,
  rationaleEvent,
  validObservabilityEvents,
} from "./observability-test-fixtures.js";

describe("Observatory event payload contracts", () => {
  it("accepts every supported event without transforming it", () => {
    for (const event of validObservabilityEvents) {
      expect(parseObservabilityEvent(event)).toEqual({ ok: true, value: event });
    }
  });

  it("accepts provider summaries and explicitly withheld computer frames", () => {
    const providerSummary = rationaleEvent();
    providerSummary.actor = { kind: "runtime", id: "runtime-a" };
    providerSummary.payload = {
      schemaVersion: "1.0",
      participantId: "player-a",
      body: "The provider returned a concise reasoning summary.",
      provenance: "provider_reasoning_summary",
      provider: "openai",
      model: "luna",
    };
    const withheldFrame = frameEvent();
    withheldFrame.payload = {
      schemaVersion: "1.0",
      participantId: "player-a",
      frameId: "frame-002",
      captureReason: "heartbeat",
      frameSequence: 2,
      mediaType: null,
      width: null,
      height: null,
      byteCount: 0,
      digest: null,
      redactionStatus: "withheld",
      withheldReason: "suspected_secret",
    };
    withheldFrame.artifactDigests = [];

    expect(parseObservabilityEvent(providerSummary).ok).toBe(true);
    expect(parseObservabilityEvent(withheldFrame).ok).toBe(true);
  });

  it("rejects non-Observatory kinds with a stable boundary error", () => {
    const result = parseObservabilityEvent(
      baseEvent({ kind: "runtime.command", payload: { command: "test" } }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatchObject({
      code: "UNSUPPORTED_OBSERVABILITY_EVENT_KIND",
      receivedKind: "runtime.command",
      issues: [{ code: "unsupported_event_kind", path: "/kind" }],
    });
  });

  it("reports strict payload failures below the payload JSON pointer", () => {
    const event = activityEvent();
    event.payload = {
      schemaVersion: "1.0",
      participantId: "player-a",
      state: "working",
      provenance: "agent_submitted",
      unexpected: true,
    };
    const result = parseObservabilityEvent(event);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("INVALID_OBSERVABILITY_EVENT");
    expect(result.error.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "required", path: "/payload/summary" }),
        expect.objectContaining({
          code: "unexpected_property",
          path: "/payload/unexpected",
        }),
      ]),
    );
  });

  it.each(["thinking", "arguments", "bearerToken", "base64"])(
    "rejects the sensitive payload field %s",
    (field) => {
      const event = activityEvent();
      event.payload = {
        ...(event.payload as Record<string, unknown>),
        [field]: "must-not-enter-the-ledger",
      };
      const result = parseObservabilityEvent(event);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.issues).toContainEqual({
        code: "unexpected_property",
        message: "Unexpected property.",
        path: `/payload/${field}`,
      });
    },
  );

  it("rejects summaries over their bounded ledger size", () => {
    const event = activityEvent();
    event.payload = {
      ...(event.payload as Record<string, unknown>),
      summary: "x".repeat(281),
    };
    const result = parseObservabilityEvent(event);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.issues).toContainEqual(
      expect.objectContaining({ code: "maxLength", path: "/payload/summary" }),
    );
  });

  it("does not allow private work to target a different participant", () => {
    const result = parseObservabilityEvent(
      baseEvent({
        ...activityEvent(),
        visibility: participantPrivate("player-b"),
      }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.issues).toContainEqual(
      expect.objectContaining({
        code: "observability_visibility",
        path: "/visibility",
      }),
    );
  });
});
