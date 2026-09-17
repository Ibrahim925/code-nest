import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../app";
import { EventLedger } from "../ledger/ledger";

const OPERATOR_TOKEN = "test-operator-token";
const AUTHORIZATION = { authorization: `Bearer ${OPERATOR_TOKEN}` };
const temporaryDirectories: string[] = [];

async function createDatabasePath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "code-nest-runs-"));
  temporaryDirectories.push(directory);
  return join(directory, "events.sqlite");
}

function lifecycleHeaders(commandId: string): Record<string, string> {
  return {
    ...AUTHORIZATION,
    "idempotency-key": commandId,
  };
}

function appOptions(databasePath: string, startingEventIndex = 0) {
  let eventIndex = startingEventIndex;
  return {
    databasePath,
    operatorToken: OPERATOR_TOKEN,
    logger: false,
    now: () => new Date("2026-09-17T16:00:00.000Z"),
    createEventId: () => `event-${++eventIndex}`,
  };
}

async function createRun(
  app: ReturnType<typeof buildApp>,
  runId = "run-001",
  commandId = "command-create",
) {
  return app.inject({
    method: "POST",
    url: "/runs",
    headers: lifecycleHeaders(commandId),
    payload: { runId },
  });
}

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { force: true, recursive: true });
  }
});

describe("run lifecycle API", () => {
  it("creates and inspects a run from its durable audit event", async () => {
    const databasePath = await createDatabasePath();
    const app = buildApp(appOptions(databasePath));

    const created = await createRun(app);
    expect(created.statusCode).toBe(201);
    expect(created.json()).toEqual({
      schemaVersion: "1.0",
      runId: "run-001",
      status: "running",
      terminalReason: null,
      createdAt: "2026-09-17T16:00:00.000Z",
      updatedAt: "2026-09-17T16:00:00.000Z",
      lastEventSequence: 1,
    });

    const inspected = await app.inject({
      method: "GET",
      url: "/runs/run-001",
      headers: AUTHORIZATION,
    });
    expect(inspected.statusCode).toBe(200);
    expect(inspected.json()).toEqual(created.json());

    const ledger = EventLedger.open(databasePath);
    expect(ledger.listEvents("run-001")).toEqual([
      expect.objectContaining({
        eventId: "event-1",
        sequence: 1,
        actor: { kind: "operator", id: "local-operator" },
        kind: "run.created",
        payload: { action: "create" },
        visibility: { class: "public" },
        causationId: "command-create",
      }),
    ]);
    ledger.close();
    await app.close();
  });

  it("pauses, resumes, and cancels with distinct durable states", async () => {
    const databasePath = await createDatabasePath();
    const app = buildApp(appOptions(databasePath));
    await createRun(app);

    const paused = await app.inject({
      method: "POST",
      url: "/runs/run-001/pause",
      headers: lifecycleHeaders("command-pause"),
    });
    expect(paused.statusCode).toBe(200);
    expect(paused.json()).toMatchObject({
      status: "paused",
      terminalReason: null,
      lastEventSequence: 2,
    });

    const resumed = await app.inject({
      method: "POST",
      url: "/runs/run-001/resume",
      headers: lifecycleHeaders("command-resume"),
    });
    expect(resumed.statusCode).toBe(200);
    expect(resumed.json()).toMatchObject({
      status: "running",
      terminalReason: null,
      lastEventSequence: 3,
    });

    const cancelled = await app.inject({
      method: "POST",
      url: "/runs/run-001/cancel",
      headers: lifecycleHeaders("command-cancel"),
    });
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json()).toMatchObject({
      status: "cancelled",
      terminalReason: "operator_cancelled",
      lastEventSequence: 4,
    });

    const ledger = EventLedger.open(databasePath);
    expect(ledger.listEvents("run-001").map((event) => event.kind)).toEqual([
      "run.created",
      "run.paused",
      "run.resumed",
      "run.cancelled",
    ]);
    expect(ledger.listEvents("run-001").at(-1)?.payload).toEqual({
      action: "cancel",
      terminalReason: "operator_cancelled",
    });
    ledger.close();
    await app.close();
  });

  it("rejects unauthorized lifecycle access without disclosing run existence", async () => {
    const databasePath = await createDatabasePath();
    const app = buildApp(appOptions(databasePath));

    const missingToken = await app.inject({
      method: "POST",
      url: "/runs",
      headers: { "idempotency-key": "command-without-token" },
      payload: { runId: "run-001" },
    });
    const wrongToken = await app.inject({
      method: "GET",
      url: "/runs/run-001",
      headers: { authorization: "Bearer wrong-token" },
    });

    expect(missingToken.statusCode).toBe(401);
    await createRun(app);
    const noAuthorization = await app.inject({
      method: "GET",
      url: "/runs/run-001",
    });
    expect(noAuthorization.statusCode).toBe(401);
    expect(wrongToken.statusCode).toBe(401);
    expect(noAuthorization.json()).toEqual(wrongToken.json());
    await app.close();
  });

  it("does not audit rejected or impossible transitions", async () => {
    const databasePath = await createDatabasePath();
    const app = buildApp(appOptions(databasePath));

    const missing = await app.inject({
      method: "POST",
      url: "/runs/missing/pause",
      headers: lifecycleHeaders("command-missing"),
    });
    expect(missing.statusCode).toBe(404);

    await createRun(app);
    const resumeRunning = await app.inject({
      method: "POST",
      url: "/runs/run-001/resume",
      headers: lifecycleHeaders("command-invalid-resume"),
    });
    expect(resumeRunning.statusCode).toBe(409);
    expect(resumeRunning.json()).toMatchObject({
      error: { code: "RUN_STATE_CONFLICT" },
    });

    await app.inject({
      method: "POST",
      url: "/runs/run-001/cancel",
      headers: lifecycleHeaders("command-cancel"),
    });
    const pauseCancelled = await app.inject({
      method: "POST",
      url: "/runs/run-001/pause",
      headers: lifecycleHeaders("command-after-cancel"),
    });
    expect(pauseCancelled.statusCode).toBe(409);

    const ledger = EventLedger.open(databasePath);
    expect(ledger.listEvents("missing")).toEqual([]);
    expect(ledger.listEvents("run-001").map((event) => event.kind)).toEqual([
      "run.created",
      "run.cancelled",
    ]);
    ledger.close();
    await app.close();
  });

  it("replays a mutation retry without duplicating or reapplying it", async () => {
    const databasePath = await createDatabasePath();
    const app = buildApp(appOptions(databasePath));
    const firstCreate = await createRun(app);
    const retriedCreate = await createRun(app);
    expect(retriedCreate.statusCode).toBe(firstCreate.statusCode);
    expect(retriedCreate.json()).toEqual(firstCreate.json());

    const firstPause = await app.inject({
      method: "POST",
      url: "/runs/run-001/pause",
      headers: lifecycleHeaders("command-pause"),
    });
    await app.inject({
      method: "POST",
      url: "/runs/run-001/resume",
      headers: lifecycleHeaders("command-resume"),
    });
    const retriedPause = await app.inject({
      method: "POST",
      url: "/runs/run-001/pause",
      headers: lifecycleHeaders("command-pause"),
    });
    expect(retriedPause.json()).toEqual(firstPause.json());

    const reusedKey = await app.inject({
      method: "POST",
      url: "/runs/run-001/cancel",
      headers: lifecycleHeaders("command-pause"),
    });
    expect(reusedKey.statusCode).toBe(409);
    expect(reusedKey.json()).toMatchObject({
      error: { code: "IDEMPOTENCY_KEY_REUSED" },
    });

    const ledger = EventLedger.open(databasePath);
    expect(ledger.listEvents("run-001")).toHaveLength(3);
    ledger.close();
    await app.close();
  });

  it("accepts only one of two concurrent state transitions", async () => {
    const databasePath = await createDatabasePath();
    const app = buildApp(appOptions(databasePath));
    await createRun(app);

    const results = await Promise.all([
      app.inject({
        method: "POST",
        url: "/runs/run-001/pause",
        headers: lifecycleHeaders("command-pause-a"),
      }),
      app.inject({
        method: "POST",
        url: "/runs/run-001/pause",
        headers: lifecycleHeaders("command-pause-b"),
      }),
    ]);
    expect(results.map((result) => result.statusCode).sort()).toEqual([
      200, 409,
    ]);

    const ledger = EventLedger.open(databasePath);
    expect(ledger.listEvents("run-001").map((event) => event.kind)).toEqual([
      "run.created",
      "run.paused",
    ]);
    ledger.close();
    await app.close();
  });

  it("restores lifecycle state after the controller restarts", async () => {
    const databasePath = await createDatabasePath();
    const firstApp = buildApp(appOptions(databasePath));
    await createRun(firstApp);
    await firstApp.inject({
      method: "POST",
      url: "/runs/run-001/pause",
      headers: lifecycleHeaders("command-pause"),
    });
    await firstApp.close();

    const restartedApp = buildApp(appOptions(databasePath, 2));
    const inspected = await restartedApp.inject({
      method: "GET",
      url: "/runs/run-001",
      headers: AUTHORIZATION,
    });
    expect(inspected.statusCode).toBe(200);
    expect(inspected.json()).toMatchObject({
      status: "paused",
      lastEventSequence: 2,
    });

    const resumed = await restartedApp.inject({
      method: "POST",
      url: "/runs/run-001/resume",
      headers: lifecycleHeaders("command-resume"),
    });
    expect(resumed.json()).toMatchObject({
      status: "running",
      lastEventSequence: 3,
    });
    await restartedApp.close();
  });

  it("rejects malformed creation and mutation metadata", async () => {
    const databasePath = await createDatabasePath();
    const app = buildApp(appOptions(databasePath));

    const malformedRun = await app.inject({
      method: "POST",
      url: "/runs",
      headers: lifecycleHeaders("command-create"),
      payload: { runId: "invalid run", extra: true },
    });
    expect(malformedRun.statusCode).toBe(400);
    expect(malformedRun.json()).toMatchObject({
      error: { code: "INVALID_RUN_REQUEST" },
    });

    const missingKey = await app.inject({
      method: "POST",
      url: "/runs",
      headers: AUTHORIZATION,
      payload: { runId: "run-001" },
    });
    expect(missingKey.statusCode).toBe(400);
    expect(missingKey.json()).toMatchObject({
      error: { code: "INVALID_IDEMPOTENCY_KEY" },
    });

    await createRun(app);
    const unexpectedBody = await app.inject({
      method: "POST",
      url: "/runs/run-001/pause",
      headers: lifecycleHeaders("command-pause"),
      payload: { force: true },
    });
    expect(unexpectedBody.statusCode).toBe(400);
    expect(unexpectedBody.json()).toMatchObject({
      error: { code: "INVALID_RUN_REQUEST" },
    });
    await app.close();
  });
});
