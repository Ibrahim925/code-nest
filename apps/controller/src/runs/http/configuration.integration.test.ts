import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../../app.js";
import { EventLedger } from "../../ledger/ledger.js";
import {
  appOptions,
  cleanupRouteFixtures,
  createDatabasePath,
  lifecycleHeaders,
} from "./routes.test-fixture.js";

const digest = `sha256:${"a".repeat(64)}`;
const configuration = {
  schemaVersion: "1.0",
  runId: "run-configured",
  scenario: {
    id: "station-access",
    manifestDigest: digest,
    repositoryRevision: "b".repeat(40),
    participantImage: `code-nest/participant@${digest}`,
    evaluatorImage: `code-nest/evaluator@${digest}`,
  },
  adapters: ["a", "b", "c", "d"].map((id) => ({
    participantId: `player-${id}`,
    adapterId: "fake-scripted",
    executionMode: "split",
    modelDisclosure: "Deterministic fixture",
  })),
  seed: 27,
  limits: {
    rounds: 3,
    roundDurationSeconds: 900,
    trustedTestWallTimeSeconds: 120,
    cpuCores: 1,
    memoryMiB: 1_024,
    processLimit: 64,
    workspaceMiB: 2_048,
    temporaryStorageMiB: 256,
  },
  disclosurePolicy: "clean-until-reveal",
  constitution: "council",
} as const;

afterEach(cleanupRouteFixtures);

describe("configured run creation", () => {
  it("records the complete reproducibility protocol in the creation event", async () => {
    const databasePath = await createDatabasePath();
    const app = buildApp(appOptions(databasePath));
    const response = await app.inject({
      method: "POST",
      url: "/runs",
      headers: lifecycleHeaders("configured-create"),
      payload: { runId: configuration.runId, configuration },
    });

    expect(response.statusCode).toBe(201);
    const ledger = EventLedger.open(databasePath);
    expect(ledger.listEvents(configuration.runId)[0]).toMatchObject({
      kind: "run.created",
      payload: { action: "create", configuration },
      visibility: { class: "public" },
    });
    ledger.close();
    await app.close();
  });

  it("rejects mismatched, malformed, and credential-bearing configurations", async () => {
    const databasePath = await createDatabasePath();
    const app = buildApp(appOptions(databasePath));
    const requests = [
      { runId: "another-run", configuration },
      {
        runId: configuration.runId,
        configuration: { ...configuration, operatorToken: "secret" },
      },
      {
        runId: configuration.runId,
        configuration: { ...configuration, adapters: configuration.adapters.slice(0, 3) },
      },
    ];

    for (const [index, payload] of requests.entries()) {
      const response = await app.inject({
        method: "POST",
        url: "/runs",
        headers: lifecycleHeaders(`invalid-config-${index}`),
        payload,
      });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        error: { code: "INVALID_RUN_REQUEST" },
      });
    }
    const ledger = EventLedger.open(databasePath);
    expect(ledger.listEvents(configuration.runId)).toEqual([]);
    ledger.close();
    await app.close();
  });

  it("replays an exact configured retry and rejects changed command reuse", async () => {
    const databasePath = await createDatabasePath();
    const app = buildApp(appOptions(databasePath));
    const request = {
      method: "POST" as const,
      url: "/runs",
      headers: lifecycleHeaders("configured-create"),
      payload: { runId: configuration.runId, configuration },
    };
    const first = await app.inject(request);
    const retry = await app.inject(request);
    const changed = await app.inject({
      ...request,
      payload: {
        ...request.payload,
        configuration: { ...configuration, seed: configuration.seed + 1 },
      },
    });

    expect(retry.statusCode).toBe(201);
    expect(retry.json()).toEqual(first.json());
    expect(changed.statusCode).toBe(409);
    expect(changed.json()).toMatchObject({
      error: { code: "IDEMPOTENCY_KEY_REUSED" },
    });
    const ledger = EventLedger.open(databasePath);
    expect(ledger.listEvents(configuration.runId)).toHaveLength(1);
    ledger.close();
    await app.close();
  });
});
