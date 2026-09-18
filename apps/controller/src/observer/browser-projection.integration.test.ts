import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Readable } from "node:stream";

import { EVENT_SCHEMA_VERSION, type EventEnvelope } from "@code-nest/protocol";
import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../app.js";
import { EventLedger, type EventDraft } from "../ledger/ledger.js";

const roots: string[] = [];
const OPERATOR = "operator-token";
const OBSERVER = "observer-token";

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, {
    force: true,
    recursive: true,
  })));
});

function event(
  index: number,
  visibility: EventEnvelope["visibility"],
  marker: string,
): EventDraft {
  return {
    schemaVersion: EVENT_SCHEMA_VERSION,
    eventId: `event-${index}`,
    runId: "run-033-stream",
    recordedAt: `2026-09-18T12:00:0${index}.000Z`,
    actor: { kind: "controller", id: "fixture" },
    context: { round: 1, phase: "work" },
    kind: "test.observation",
    payload: { marker },
    visibility,
    causationId: `command-${index}`,
    correlationId: "stream-033",
    parentEventIds: [],
    artifactDigests: [],
    resourceCost: {},
  };
}

async function firstEventId(stream: Readable): Promise<string> {
  let buffer = "";
  for await (const chunk of stream) {
    buffer += new TextDecoder().decode(chunk as Uint8Array);
    const match = /(?:^|\n)id: ([^\n]+)\n/.exec(buffer);
    if (match?.[1] !== undefined) return match[1];
  }
  throw new Error("SSE stream ended before an event arrived.");
}

describe("browser observer stream projection", () => {
  it("uses the durable observer mode even when the browser holds an operator credential", async () => {
    const root = await mkdtemp(join(tmpdir(), "code-nest-observer-stream-"));
    roots.push(root);
    const databasePath = join(root, "events.sqlite");
    const ledger = EventLedger.open(databasePath);
    const entries: Array<[EventEnvelope["visibility"], string]> = [
      [{ class: "public" }, "PUBLIC"],
      [{ class: "covert", recipientIds: ["player-a"] }, "COVERT"],
      [{ class: "public" }, "PUBLIC_AFTER"],
      [{ class: "operator_private" }, "OPERATOR_ONLY"],
    ];
    entries.forEach(([visibility, marker], offset) => {
      const index = offset + 1;
      ledger.appendCommandEvent(`command-${index}`, event(index, visibility, marker));
    });
    ledger.close();
    let nextId = 5;
    const app = buildApp({
      databasePath,
      operatorToken: OPERATOR,
      observerToken: OBSERVER,
      createEventId: () => `event-${nextId++}`,
      logger: false,
    });
    const browserHeaders = {
      authorization: `Bearer ${OPERATOR}`,
      "x-code-nest-observer-view": "1",
    };

    const sealedCursor = await app.inject({
      method: "GET",
      url: "/runs/run-033-stream/events",
      headers: { ...browserHeaders, "last-event-id": "event-2" },
    });
    expect(sealedCursor.statusCode).toBe(400);
    expect(sealedCursor.json()).toMatchObject({ error: { code: "INVALID_EVENT_CURSOR" } });

    const unblind = await app.inject({
      method: "POST",
      url: "/runs/run-033-stream/observer-mode/unblind",
      headers: {
        authorization: `Bearer ${OPERATOR}`,
        "idempotency-key": "unblind-stream-033",
      },
      payload: {},
    });
    expect(unblind.statusCode).toBe(200);

    const controller = new AbortController();
    const unblinded = await app.inject({
      method: "GET",
      url: "/runs/run-033-stream/events",
      headers: { ...browserHeaders, "last-event-id": "event-2" },
      signal: controller.signal,
      payloadAsStream: true,
    });
    const stream = unblinded.stream();
    expect(await firstEventId(stream)).toBe("event-3");
    controller.abort();
    stream.destroy();

    const infrastructureCursor = await app.inject({
      method: "GET",
      url: "/runs/run-033-stream/events",
      headers: { ...browserHeaders, "last-event-id": "event-4" },
    });
    expect(infrastructureCursor.statusCode).toBe(400);
    await app.close();
  });
});
