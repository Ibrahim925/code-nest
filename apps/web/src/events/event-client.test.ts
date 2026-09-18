import { describe, expect, it } from "vitest";

import {
  LiveEventClient,
  LiveEventClientError,
} from "./application/live-event-client.js";
import {
  EventStreamTransportError,
  type EventDeliveryDecoder,
  type EventStreamRequest,
  type EventStreamTransport,
} from "./application/ports/event-stream.js";
import type {
  DecodedEventDelivery,
  LiveConnectionState,
  SseEventFrame,
} from "./domain/live-events.js";

function frame(sequence: number, eventId = `event-${sequence}`): SseEventFrame {
  return {
    id: eventId,
    event: "code-nest-event",
    data: JSON.stringify({ sequence, eventId, kind: "test.event" }),
  };
}

const decoder: EventDeliveryDecoder = {
  decode(value) {
    const parsed = JSON.parse(value.data) as Record<string, unknown>;
    if (
      value.event !== "code-nest-event" ||
      typeof parsed.sequence !== "number" ||
      typeof parsed.eventId !== "string" ||
      parsed.eventId !== value.id ||
      typeof parsed.kind !== "string"
    ) {
      throw new LiveEventClientError(
        "INVALID_EVENT_DELIVERY",
        "The controller sent an invalid live event delivery.",
      );
    }
    return {
      deliverySequence: parsed.sequence,
      eventId: parsed.eventId,
      kind: parsed.kind,
      event: parsed,
    };
  },
};

type Episode = readonly SseEventFrame[] | Error;

class EpisodeTransport implements EventStreamTransport {
  readonly requests: EventStreamRequest[] = [];

  constructor(private readonly episodes: Episode[]) {}

  async open(request: EventStreamRequest): Promise<AsyncIterable<SseEventFrame>> {
    this.requests.push(request);
    const episode = this.episodes.shift();
    if (episode === undefined) {
      throw new EventStreamTransportError(
        "STREAM_EXHAUSTED",
        "No fake stream episode remains.",
        true,
      );
    }
    if (episode instanceof Error) throw episode;
    return (async function* () {
      for (const value of episode) yield value;
    })();
  }
}

interface FollowResult {
  readonly deliveries: DecodedEventDelivery[];
  readonly states: LiveConnectionState[];
  readonly requests: EventStreamRequest[];
}

async function followEpisodes(
  episodes: Episode[],
  stopAfterDeliveries: number,
  maximumReconnectAttempts = 4,
): Promise<FollowResult> {
  const transport = new EpisodeTransport(episodes);
  const controller = new AbortController();
  const deliveries: DecodedEventDelivery[] = [];
  const states: LiveConnectionState[] = [];
  const client = new LiveEventClient({
    transport,
    decoder,
    maximumReconnectAttempts,
    waitBeforeReconnect: async () => undefined,
  });
  await client.follow(
    {
      runId: "run-028",
      bearerToken: "observer-secret",
      signal: controller.signal,
    },
    {
      onDelivery(delivery) {
        deliveries.push(delivery);
        if (deliveries.length === stopAfterDeliveries) controller.abort();
      },
      onState(state) {
        states.push(state);
      },
    },
  );
  return { deliveries, states, requests: transport.requests };
}

describe("live event client recovery", () => {
  it("reconnects from the last visible event and fills a disconnect gap", async () => {
    const result = await followEpisodes([[frame(1)], [frame(2), frame(3)]], 3);
    expect(result.deliveries.map(({ eventId }) => eventId)).toEqual([
      "event-1",
      "event-2",
      "event-3",
    ]);
    expect(result.requests.map(({ lastEventId }) => lastEventId)).toEqual([
      undefined,
      "event-1",
    ]);
    expect(result.states).toContainEqual(
      expect.objectContaining({ status: "recovering", reason: "transport_closed" }),
    );
    expect(result.states.at(-1)).toMatchObject({
      status: "stopped",
      nextDeliverySequence: 4,
    });
  });

  it("detects an explicit sequence gap and recovers the missing delivery", async () => {
    const result = await followEpisodes(
      [[frame(1), frame(3)], [frame(2), frame(3)]],
      3,
    );
    expect(result.deliveries.map(({ deliverySequence }) => deliverySequence)).toEqual([
      1, 2, 3,
    ]);
    expect(result.states).toContainEqual(
      expect.objectContaining({ status: "recovering", reason: "sequence_gap" }),
    );
    expect(result.requests[1]?.lastEventId).toBe("event-1");
  });

  it("deduplicates an at-least-once delivery after reconnect", async () => {
    const result = await followEpisodes([[frame(1)], [frame(1), frame(2)]], 2);
    expect(result.deliveries.map(({ eventId }) => eventId)).toEqual([
      "event-1",
      "event-2",
    ]);
  });

  it("fails closed when an event ID or prior sequence changes meaning", async () => {
    const reusedId = await followEpisodes(
      [[frame(1, "event-reused")], [frame(2, "event-reused")]],
      99,
    );
    expect(reusedId.states.at(-1)).toMatchObject({
      status: "failed",
      code: "EVENT_ID_CONFLICT",
    });

    const reusedSequence = await followEpisodes(
      [[frame(1), frame(1, "different-event")]],
      99,
    );
    expect(reusedSequence.states.at(-1)).toMatchObject({
      status: "failed",
      code: "DELIVERY_SEQUENCE_CONFLICT",
    });
  });

  it("reports recovery attempts and a bounded terminal failure honestly", async () => {
    const unavailable = new EventStreamTransportError(
      "NETWORK_FAILURE",
      "Network unavailable.",
      true,
    );
    const result = await followEpisodes(
      [unavailable, unavailable, unavailable],
      99,
      2,
    );
    expect(
      result.states.filter(({ status }) => status === "recovering"),
    ).toHaveLength(2);
    expect(result.states.at(-1)).toEqual({
      status: "failed",
      code: "EVENT_STREAM_UNAVAILABLE",
      message: "The live event stream could not be recovered.",
      lastEventId: null,
    });
  });

  it("does not retry authorization or protocol failures", async () => {
    const denied = new EventStreamTransportError(
      "UNAUTHORIZED",
      "Valid stream authorization is required.",
      false,
    );
    const result = await followEpisodes([denied], 99);
    expect(result.requests).toHaveLength(1);
    expect(result.states.at(-1)).toMatchObject({
      status: "failed",
      code: "UNAUTHORIZED",
    });
  });

  it("stops cleanly when cancellation interrupts a recovery wait", async () => {
    const controller = new AbortController();
    const states: LiveConnectionState[] = [];
    const client = new LiveEventClient({
      transport: new EpisodeTransport([
        new EventStreamTransportError("NETWORK_FAILURE", "Offline.", true),
      ]),
      decoder,
      waitBeforeReconnect: async (_attempt, signal) => {
        if (signal.aborted) return;
        await new Promise<void>((resolve) => {
          signal.addEventListener("abort", () => resolve(), { once: true });
        });
      },
    });
    await client.follow(
      {
        runId: "run-028",
        bearerToken: "observer-secret",
        signal: controller.signal,
      },
      {
        onDelivery: () => undefined,
        onState(state) {
          states.push(state);
          if (state.status === "recovering") controller.abort();
        },
      },
    );
    expect(states.at(-1)).toMatchObject({ status: "stopped" });
  });
});
