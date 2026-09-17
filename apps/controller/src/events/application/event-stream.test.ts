import {
  EVENT_SCHEMA_VERSION,
  type EventDelivery,
  type EventEnvelope,
} from "@code-nest/protocol";
import { describe, expect, it } from "vitest";

import {
  EventStreamService,
} from "./event-stream";
import type { EventStreamSink } from "./ports/event-stream";
import type { EventStreamSource } from "./ports/event-stream-source";

function event(
  sequence: number,
  visibility: EventEnvelope["visibility"] = { class: "public" },
): EventEnvelope {
  return {
    schemaVersion: EVENT_SCHEMA_VERSION,
    eventId: `event-${sequence}`,
    runId: "run-001",
    sequence,
    recordedAt: `2026-09-17T16:00:0${sequence}.000Z`,
    actor: { kind: "controller", id: "controller" },
    context: { round: 1, phase: "work" },
    kind: "test.event",
    payload: { marker: `event-${sequence}` },
    visibility,
    causationId: null,
    correlationId: "test-stream",
    parentEventIds: [],
    artifactDigests: [],
    resourceCost: {},
  };
}

class RaceSource implements EventStreamSource {
  readonly events = [event(1), event(2)];
  listener: ((event: EventEnvelope) => void) | undefined;
  raceDelivered = false;

  hasEvents(runId: string): boolean {
    return runId === "run-001";
  }

  getEvent(eventId: string): EventEnvelope | undefined {
    return this.events.find((item) => item.eventId === eventId);
  }

  listEvents(
    _runId: string,
    afterSequence: number,
    limit: number,
  ): EventEnvelope[] {
    void limit;
    if (!this.raceDelivered) {
      this.raceDelivered = true;
      const racedEvent = this.events[1];
      if (racedEvent !== undefined) this.listener?.(racedEvent);
    }
    return this.events.filter((item) => item.sequence > afterSequence);
  }

  subscribe(
    _runId: string,
    listener: (event: EventEnvelope) => void,
  ): () => void {
    this.listener = listener;
    return () => {
      this.listener = undefined;
    };
  }
}

class RecordingSink implements EventStreamSink {
  readonly deliveries: EventDelivery[] = [];

  send(delivery: EventDelivery): void {
    this.deliveries.push(delivery);
  }
}

const cleanObserver = {
  runId: "run-001",
  revealState: "sealed",
  audience: { kind: "observer", mode: "clean" },
} as const;

describe("event stream application service", () => {
  it("closes the subscribe-before-catch-up race without duplicate delivery", () => {
    const source = new RaceSource();
    const sink = new RecordingSink();
    const service = new EventStreamService(source);

    const close = service.open(
      cleanObserver,
      { sourceSequence: 0, deliverySequence: 0 },
      sink,
    );
    expect(sink.deliveries.map((item) => item.event.eventId)).toEqual([
      "event-1",
      "event-2",
    ]);
    expect(sink.deliveries.map((item) => item.deliverySequence)).toEqual([
      1, 2,
    ]);

    source.listener?.(event(2));
    source.listener?.(event(3));
    expect(sink.deliveries.map((item) => item.event.eventId)).toEqual([
      "event-1",
      "event-2",
      "event-3",
    ]);

    close();
    source.listener?.(event(4));
    expect(sink.deliveries.map((item) => item.event.eventId)).toEqual([
      "event-1",
      "event-2",
      "event-3",
    ]);
  });

  it("projects denied events and assigns contiguous audience sequences", () => {
    const source = new RaceSource();
    source.events.splice(
      0,
      source.events.length,
      event(1),
      event(2, { class: "covert", recipientIds: ["player-a"] }),
      event(3),
    );
    const sink = new RecordingSink();
    const service = new EventStreamService(source);

    service.open(
      cleanObserver,
      { sourceSequence: 0, deliverySequence: 0 },
      sink,
    );

    expect(sink.deliveries.map((item) => item.deliverySequence)).toEqual([
      1, 2,
    ]);
    expect(sink.deliveries.map((item) => item.event.eventId)).toEqual([
      "event-1",
      "event-3",
    ]);
    expect(sink.deliveries.every((item) => !("sequence" in item.event))).toBe(
      true,
    );
    expect(service.resolveCursor(cleanObserver, "event-3")).toEqual({
      sourceSequence: 3,
      deliverySequence: 2,
    });
  });
});
