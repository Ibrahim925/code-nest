import { describe, expect, it } from "vitest";

import { createLiveEventClient } from "./create-live-event-client.js";
import type { DecodedEventDelivery, LiveConnectionState } from "./domain/live-events.js";

const delivery = {
  deliveryVersion: "1.0",
  deliverySequence: 1,
  event: {
    schemaVersion: "1.0",
    eventId: "event-1",
    runId: "run-028",
    recordedAt: "2026-09-18T12:00:00.000Z",
    actor: { kind: "controller", id: "controller" },
    context: { round: 1, phase: "work" },
    kind: "run.started",
    payload: {},
    visibility: { class: "public" },
    causationId: "command-1",
    correlationId: "run-028",
    parentEventIds: [],
    artifactDigests: [],
    resourceCost: {},
  },
} as const;

describe("live event client composition", () => {
  it("streams and decodes a controller delivery through the real adapters", async () => {
    const encoder = new TextEncoder();
    const responseBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            `id: event-1\nevent: code-nest-event\ndata: ${JSON.stringify(delivery)}\n\n`,
          ),
        );
        controller.close();
      },
    });
    const controller = new AbortController();
    const received: DecodedEventDelivery[] = [];
    const states: LiveConnectionState[] = [];
    const client = createLiveEventClient({
      baseUrl: "/api",
      fetcher: async () =>
        new Response(responseBody, {
          headers: { "content-type": "text/event-stream" },
        }),
    });

    await client.follow(
      {
        runId: "run-028",
        bearerToken: "observer-secret",
        signal: controller.signal,
      },
      {
        onDelivery(value) {
          received.push(value);
          controller.abort();
        },
        onState(state) {
          states.push(state);
        },
      },
    );

    expect(received).toEqual([
      expect.objectContaining({
        deliverySequence: 1,
        eventId: "event-1",
        kind: "run.started",
      }),
    ]);
    expect(states.map(({ status }) => status)).toEqual([
      "connecting",
      "live",
      "stopped",
    ]);
  });
});
