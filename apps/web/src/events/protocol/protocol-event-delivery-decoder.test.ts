import { describe, expect, it } from "vitest";

import type { SseEventFrame } from "../domain/live-events.js";
import { ProtocolEventDeliveryDecoder } from "./protocol-event-delivery-decoder.js";

const validDelivery = {
  deliveryVersion: "1.0",
  deliverySequence: 1,
  event: {
    schemaVersion: "1.0",
    eventId: "event-1",
    runId: "run-028",
    recordedAt: "2026-09-18T12:00:00.000Z",
    actor: { kind: "controller", id: "controller" },
    context: { round: 1, phase: "work" },
    kind: "test.event",
    payload: { marker: "one" },
    visibility: { class: "public" },
    causationId: "command-1",
    correlationId: "run-028",
    parentEventIds: [],
    artifactDigests: [],
    resourceCost: {},
  },
} as const;

function frame(overrides: Partial<SseEventFrame> = {}): SseEventFrame {
  return {
    id: "event-1",
    event: "code-nest-event",
    data: JSON.stringify(validDelivery),
    ...overrides,
  };
}

describe("protocol event delivery decoder", () => {
  const decoder = new ProtocolEventDeliveryDecoder();

  it("returns only a strict Version 1 audience delivery", () => {
    expect(decoder.decode(frame())).toEqual({
      deliverySequence: 1,
      eventId: "event-1",
      kind: "test.event",
      event: validDelivery.event,
    });
  });

  it("rejects malformed JSON and unexpected SSE event types", () => {
    expect(() => decoder.decode(frame({ data: "{" }))).toThrowError(
      expect.objectContaining({ code: "INVALID_EVENT_JSON" }),
    );
    expect(() => decoder.decode(frame({ event: "message" }))).toThrowError(
      expect.objectContaining({ code: "INVALID_EVENT_TYPE" }),
    );
  });

  it("rejects unsupported delivery versions through the shared parser", () => {
    expect(() =>
      decoder.decode(
        frame({
          data: JSON.stringify({ ...validDelivery, deliveryVersion: "2.0" }),
        }),
      ),
    ).toThrowError(
      expect.objectContaining({ code: "UNSUPPORTED_EVENT_DELIVERY_VERSION" }),
    );
  });

  it("rejects leaked ledger fields and mismatched SSE identifiers", () => {
    expect(() =>
      decoder.decode(
        frame({
          data: JSON.stringify({
            ...validDelivery,
            event: { ...validDelivery.event, sequence: 1 },
          }),
        }),
      ),
    ).toThrowError(expect.objectContaining({ code: "INVALID_EVENT_DELIVERY" }));
    expect(() => decoder.decode(frame({ id: "different-event" }))).toThrowError(
      expect.objectContaining({ code: "EVENT_ID_MISMATCH" }),
    );
  });
});
