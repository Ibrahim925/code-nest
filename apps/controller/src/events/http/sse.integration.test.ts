import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Readable } from "node:stream";

import {
  EVENT_SCHEMA_VERSION,
  parseEventDelivery,
  type EventDelivery,
  type EventEnvelope,
} from "@code-nest/protocol";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../../app";
import { EventLedger, type EventDraft } from "../../ledger/ledger";

const OPERATOR_TOKEN = "test-operator-token";
const OBSERVER_TOKEN = "test-observer-token";
const temporaryDirectories: string[] = [];
const openApps: FastifyInstance[] = [];

async function createDatabasePath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "code-nest-sse-"));
  temporaryDirectories.push(directory);
  return join(directory, "events.sqlite");
}

function draft(
  sequence: number,
  visibility: EventEnvelope["visibility"],
  marker: string,
): EventDraft {
  const commandId = `command-${sequence}`;
  return {
    schemaVersion: EVENT_SCHEMA_VERSION,
    eventId: `event-${sequence}`,
    runId: "run-001",
    recordedAt: `2026-09-17T16:00:0${sequence}.000Z`,
    actor: { kind: "controller", id: "controller" },
    context: { round: 1, phase: "work" },
    kind: "test.event",
    payload: { marker },
    visibility,
    causationId: commandId,
    correlationId: "test-stream",
    parentEventIds: [],
    artifactDigests: [],
    resourceCost: {},
  };
}

function seed(databasePath: string): void {
  const ledger = EventLedger.open(databasePath);
  const entries: Array<[EventEnvelope["visibility"], string]> = [
    [{ class: "public" }, "public-one"],
    [{ class: "covert", recipientIds: ["player-a"] }, "PRIVATE_COVERT"],
    [{ class: "public" }, "public-three"],
    [{ class: "operator_private" }, "OPERATOR_ONLY"],
  ];
  entries.forEach(([visibility, marker], index) => {
    const sequence = index + 1;
    ledger.appendCommandEvent(
      `command-${sequence}`,
      draft(sequence, visibility, marker),
    );
  });
  ledger.close();
}

function appOptions(databasePath: string) {
  let eventIndex = 0;
  return {
    databasePath,
    operatorToken: OPERATOR_TOKEN,
    observerToken: OBSERVER_TOKEN,
    logger: false,
    now: () => new Date("2026-09-17T16:00:00.000Z"),
    createEventId: () => `event-${++eventIndex}`,
  };
}

function createApp(databasePath: string): FastifyInstance {
  const app = buildApp(appOptions(databasePath));
  openApps.push(app);
  return app;
}

interface SseFrame {
  readonly id: string;
  readonly event: string;
  readonly data: string;
}

async function readFrames(
  stream: Readable,
  count: number,
): Promise<SseFrame[]> {
  const decoder = new TextDecoder();
  const frames: SseFrame[] = [];
  let buffer = "";
  const iterator = stream[Symbol.asyncIterator]();

  while (frames.length < count) {
    const result = await iterator.next();
    if (result.done) throw new Error("SSE response ended before expected events.");
    buffer += decoder.decode(result.value as Uint8Array, { stream: true });
    const blocks = buffer.split("\n\n");
    buffer = blocks.pop() ?? "";
    for (const block of blocks) {
      if (block.startsWith(":")) continue;
      const fields = Object.fromEntries(
        block.split("\n").map((line) => {
          const separator = line.indexOf(":");
          return [line.slice(0, separator), line.slice(separator + 1).trimStart()];
        }),
      );
      if (
        fields.id !== undefined &&
        fields.event !== undefined &&
        fields.data !== undefined
      ) {
        frames.push({ id: fields.id, event: fields.event, data: fields.data });
      }
    }
  }
  return frames;
}

function stopReading(controller: AbortController, stream: Readable): void {
  controller.abort();
  stream.destroy();
}

function parseDeliveries(frames: SseFrame[]): EventDelivery[] {
  return frames.map((frame) => {
    const parsed = parseEventDelivery(JSON.parse(frame.data));
    if (!parsed.ok) {
      throw new Error(`Invalid event delivery: ${parsed.error.message}`);
    }
    return parsed.value;
  });
}

afterEach(async () => {
  for (const app of openApps.splice(0)) await app.close();
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { force: true, recursive: true });
  }
});

describe("reconnectable SSE event stream", () => {
  it("requires stream authorization and rejects unavailable cursors", async () => {
    const databasePath = await createDatabasePath();
    seed(databasePath);
    const app = createApp(databasePath);

    const unauthorized = await app.inject({
      method: "GET",
      url: "/runs/run-001/events",
    });
    expect(unauthorized.statusCode).toBe(401);

    const missingRun = await app.inject({
      method: "GET",
      url: "/runs/missing/events",
      headers: { authorization: `Bearer ${OBSERVER_TOKEN}` },
    });
    expect(missingRun.statusCode).toBe(404);

    const hiddenCursor = await app.inject({
      method: "GET",
      url: "/runs/run-001/events",
      headers: {
        authorization: `Bearer ${OBSERVER_TOKEN}`,
        "last-event-id": "event-2",
      },
    });
    expect(hiddenCursor.statusCode).toBe(400);
    expect(hiddenCursor.json()).toMatchObject({
      error: { code: "INVALID_EVENT_CURSOR" },
    });
  });

  it("streams only events authorized for the authenticated audience", async () => {
    const databasePath = await createDatabasePath();
    seed(databasePath);
    const app = createApp(databasePath);

    const observerAbort = new AbortController();
    const observerResponse = await app.inject({
      method: "GET",
      url: "/runs/run-001/events",
      headers: { authorization: `Bearer ${OBSERVER_TOKEN}` },
      signal: observerAbort.signal,
      payloadAsStream: true,
    });
    expect(observerResponse.statusCode).toBe(200);
    expect(observerResponse.headers["content-type"]).toBe(
      "text/event-stream; charset=utf-8",
    );
    const observerStream = observerResponse.stream();
    const observer = await readFrames(observerStream, 2);
    expect(observer.map((frame) => frame.id)).toEqual([
      "event-1",
      "event-3",
    ]);
    expect(observer.every((frame) => frame.event === "code-nest-event")).toBe(
      true,
    );
    const observerDeliveries = parseDeliveries(observer);
    expect(
      observerDeliveries.map((delivery) => delivery.deliverySequence),
    ).toEqual([1, 2]);
    expect(
      observerDeliveries.map((delivery) => delivery.event.eventId),
    ).toEqual(["event-1", "event-3"]);
    expect(
      observerDeliveries.every(
        (delivery) => !("sequence" in delivery.event),
      ),
    ).toBe(true);
    expect(observer.map((frame) => frame.data).join(" ")).not.toContain(
      "PRIVATE_COVERT",
    );
    stopReading(observerAbort, observerStream);

    const operatorAbort = new AbortController();
    const operatorResponse = await app.inject({
      method: "GET",
      url: "/runs/run-001/events",
      headers: { authorization: `Bearer ${OPERATOR_TOKEN}` },
      signal: operatorAbort.signal,
      payloadAsStream: true,
    });
    const operatorStream = operatorResponse.stream();
    const operator = await readFrames(operatorStream, 4);
    expect(operator.map((frame) => frame.id)).toEqual([
      "event-1",
      "event-2",
      "event-3",
      "event-4",
    ]);
    expect(
      parseDeliveries(operator).map((delivery) => delivery.deliverySequence),
    ).toEqual([1, 2, 3, 4]);
    stopReading(operatorAbort, operatorStream);
  });

  it("resumes strictly after the last authorized event ID", async () => {
    const databasePath = await createDatabasePath();
    seed(databasePath);
    const app = createApp(databasePath);
    const controller = new AbortController();

    const response = await app.inject({
      method: "GET",
      url: "/runs/run-001/events",
      headers: {
        authorization: `Bearer ${OBSERVER_TOKEN}`,
        "last-event-id": "event-1",
      },
      signal: controller.signal,
      payloadAsStream: true,
    });
    const responseStream = response.stream();
    const frames = await readFrames(responseStream, 1);

    expect(frames).toEqual([
      expect.objectContaining({ id: "event-3" }),
    ]);
    expect(parseDeliveries(frames)).toEqual([
      expect.objectContaining({
        deliverySequence: 2,
        event: expect.objectContaining({ eventId: "event-3" }),
      }),
    ]);
    stopReading(controller, responseStream);
  });

  it("publishes a live event only after its ledger commit", async () => {
    const databasePath = await createDatabasePath();
    const app = createApp(databasePath);

    const createResponse = await app.inject({
      method: "POST",
      url: "/runs",
      headers: {
        authorization: `Bearer ${OPERATOR_TOKEN}`,
        "content-type": "application/json",
        "idempotency-key": "command-create",
      },
      payload: { runId: "run-001" },
    });
    expect(createResponse.statusCode).toBe(201);

    const controller = new AbortController();
    const response = await app.inject({
      method: "GET",
      url: "/runs/run-001/events",
      headers: {
        authorization: `Bearer ${OBSERVER_TOKEN}`,
        "last-event-id": "event-1",
      },
      signal: controller.signal,
      payloadAsStream: true,
    });

    const pauseResponse = await app.inject({
      method: "POST",
      url: "/runs/run-001/pause",
      headers: {
        authorization: `Bearer ${OPERATOR_TOKEN}`,
        "idempotency-key": "command-pause",
      },
    });
    expect(pauseResponse.statusCode).toBe(200);

    const responseStream = response.stream();
    const frames = await readFrames(responseStream, 1);
    const frame = frames[0];
    expect(frame).toBeDefined();
    if (frame === undefined) throw new Error("Expected one live event frame.");
    expect(frame).toMatchObject({ id: "event-2" });
    expect(parseDeliveries([frame])).toEqual([
      expect.objectContaining({
        deliverySequence: 2,
        event: expect.objectContaining({ kind: "run.paused" }),
      }),
    ]);
    expect(JSON.parse(frame.data)).toMatchObject({
      deliverySequence: 2,
      event: { kind: "run.paused" },
    });

    const ledger = EventLedger.open(databasePath);
    expect(ledger.getEvent("event-2")).toMatchObject({
      sequence: 2,
      kind: "run.paused",
    });
    ledger.close();
    stopReading(controller, responseStream);
  });
});
