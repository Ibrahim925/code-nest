import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseReplayBundle, type ReplayBundle } from "@code-nest/protocol";
import { afterEach, describe, expect, it } from "vitest";

import { ArtifactStore } from "../artifacts/store.js";
import { buildApp } from "../app.js";
import { EventLedger, type EventDraft } from "../ledger/ledger.js";

const OPERATOR = "operator-replay-token";
const OBSERVER = "observer-replay-token";
const roots: string[] = [];
const HASH = `sha256:${"a".repeat(64)}`;
const REVISION = "b".repeat(40);

function configuration() {
  return {
    schemaVersion: "1.0",
    runId: "run-replay",
    scenario: {
      id: "station-access",
      manifestDigest: HASH,
      repositoryRevision: REVISION,
      participantImage: `code-nest/participant@${HASH}`,
      evaluatorImage: `code-nest/evaluator@${HASH}`,
    },
    adapters: ["a", "b", "c", "d"].map((id) => ({
      participantId: `player-${id}`,
      adapterId: "fake-scripted",
      executionMode: "split",
      modelDisclosure: "Deterministic fixture",
    })),
    seed: 17,
    limits: {
      rounds: 3,
      roundDurationSeconds: 60,
      trustedTestWallTimeSeconds: 60,
      cpuCores: 1,
      memoryMiB: 512,
      processLimit: 32,
      workspaceMiB: 256,
      temporaryStorageMiB: 64,
    },
    disclosurePolicy: "clean-until-reveal",
    constitution: "council",
  };
}

function draft(input: {
  readonly eventId: string;
  readonly runId?: string;
  readonly kind: string;
  readonly payload: EventDraft["payload"];
  readonly visibility?: EventDraft["visibility"];
  readonly artifactDigests?: readonly string[];
}): EventDraft {
  return {
    schemaVersion: "1.0",
    eventId: input.eventId,
    runId: input.runId ?? "run-replay",
    recordedAt: "2026-09-18T10:00:00.000Z",
    actor: { kind: "controller", id: "test-controller" },
    context: { round: null, phase: null },
    kind: input.kind,
    payload: input.payload,
    visibility: input.visibility ?? { class: "public" },
    causationId: `command-${input.eventId}`,
    correlationId: input.runId ?? "run-replay",
    parentEventIds: [],
    artifactDigests: [...(input.artifactDigests ?? [])],
    resourceCost: {},
  };
}

async function fixture(terminal = true) {
  const root = await mkdtemp(join(tmpdir(), "code-nest-replay-"));
  roots.push(root);
  const databasePath = join(root, "events.sqlite");
  const artifactRoot = join(root, "artifacts");
  const artifacts = await ArtifactStore.open(artifactRoot);
  const publicArtifact = await artifacts.put({
    runId: "run-replay",
    bytes: Buffer.from("public replay evidence"),
    mediaType: "text/plain",
    redactedPreview: "public evidence",
    visibility: { class: "public" },
  });
  const privateArtifact = await artifacts.put({
    runId: "run-replay",
    bytes: Buffer.from("private belief evidence"),
    mediaType: "text/plain",
    redactedPreview: "private evidence",
    visibility: { class: "participant_private", recipientIds: ["player-a"] },
  });
  const ledger = EventLedger.open(databasePath);
  const events = [
    draft({
      eventId: "event-created",
      kind: "run.created",
      payload: { action: "create", configuration: configuration() },
    }),
    draft({
      eventId: "event-public",
      kind: "runtime.terminal_output",
      payload: { participantId: "player-a", text: "safe output", stream: "stdout" },
      artifactDigests: [publicArtifact.digest],
    }),
    draft({
      eventId: "event-private",
      kind: "belief.reported",
      payload: { secretMarker: "PRIVATE_MARKER" },
      visibility: { class: "participant_private", recipientIds: ["player-a"] },
      artifactDigests: [privateArtifact.digest],
    }),
    ...(terminal ? [draft({
      eventId: "event-cancelled",
      kind: "run.cancelled",
      payload: { action: "cancel", terminalReason: "operator_cancelled" },
    })] : []),
  ];
  events.forEach((event) => {
    if (event.causationId === null) throw new Error("Fixture event needs causation.");
    ledger.appendCommandEvent(event.causationId, event);
  });
  ledger.close();
  const app = buildApp({
    databasePath,
    artifactRoot,
    operatorToken: OPERATOR,
    observerToken: OBSERVER,
    createEventId: () => "event-unblinded",
    now: () => new Date("2026-09-18T10:05:00.000Z"),
    logger: false,
  });
  return { app, publicArtifact, privateArtifact };
}

function parsedBundle(body: string): ReplayBundle {
  const parsed = parseReplayBundle(JSON.parse(body));
  if (!parsed.ok) throw new Error(parsed.error.message);
  return parsed.value;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("portable replay export", () => {
  it("exports only the durable Clean projection with embedded verified artifacts", async () => {
    const { app, publicArtifact, privateArtifact } = await fixture();
    const unauthorized = await app.inject({ method: "GET", url: "/runs/run-replay/replay" });
    expect(unauthorized.statusCode).toBe(401);

    const response = await app.inject({
      method: "GET",
      url: "/runs/run-replay/replay",
      headers: { authorization: `Bearer ${OPERATOR}` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-disposition"]).toContain("run-replay.replay.json");
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.body).not.toContain("PRIVATE_MARKER");
    expect(response.body).not.toContain(privateArtifact.digest);
    expect(response.body).not.toContain("\"sequence\":");

    const bundle = parsedBundle(response.body);
    expect(bundle.perspective).toEqual({ mode: "clean", benchmarkEligible: true });
    expect(bundle.deliveries.map(({ event }) => event.eventId)).toEqual([
      "event-created", "event-public", "event-cancelled",
    ]);
    expect(bundle.artifacts).toEqual([
      expect.objectContaining({
        digest: publicArtifact.digest,
        content: Buffer.from("public replay evidence").toString("base64"),
      }),
    ]);
    await app.close();
  });

  it("reprojects authorized history after audited unblinding", async () => {
    const { app, privateArtifact } = await fixture();
    const unblind = await app.inject({
      method: "POST",
      url: "/runs/run-replay/observer-mode/unblind",
      headers: {
        authorization: `Bearer ${OPERATOR}`,
        "idempotency-key": "command-unblind-replay",
      },
    });
    expect(unblind.statusCode).toBe(200);
    const response = await app.inject({
      method: "GET",
      url: "/runs/run-replay/replay",
      headers: { authorization: `Bearer ${OBSERVER}` },
    });
    const bundle = parsedBundle(response.body);
    expect(bundle.perspective).toEqual({ mode: "unblinded", benchmarkEligible: false });
    expect(bundle.deliveries.map(({ event }) => event.eventId)).toContain("event-private");
    expect(bundle.deliveries.at(-1)?.event.kind).toBe("observer_unblinded");
    expect(bundle.artifacts.map(({ digest }) => digest)).toContain(privateArtifact.digest);
    await app.close();
  });

  it("rejects active and unknown runs without producing a partial bundle", async () => {
    const { app } = await fixture(false);
    const headers = { authorization: `Bearer ${OBSERVER}` };
    expect((await app.inject({ method: "GET", url: "/runs/run-replay/replay", headers })).statusCode)
      .toBe(409);
    expect((await app.inject({ method: "GET", url: "/runs/missing/replay", headers })).statusCode)
      .toBe(404);
    await app.close();
  });
});
