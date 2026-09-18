import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { EVENT_SCHEMA_VERSION } from "@code-nest/protocol";
import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../app.js";
import { ArtifactStore } from "../artifacts/store.js";
import { EventLedger } from "../ledger/ledger.js";

const roots: string[] = [];
const OPERATOR = "operator-token";
const OBSERVER = "observer-token";

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, {
    force: true,
    recursive: true,
  })));
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "code-nest-observer-mode-"));
  roots.push(root);
  const databasePath = join(root, "events.sqlite");
  const artifactRoot = join(root, "artifacts");
  let nextId = 1;
  const app = buildApp({
    databasePath,
    artifactRoot,
    operatorToken: OPERATOR,
    observerToken: OBSERVER,
    createEventId: () => `event-${nextId++}`,
    now: () => new Date("2026-09-18T12:00:00.000Z"),
    logger: false,
  });
  const created = await app.inject({
    method: "POST",
    url: "/runs",
    headers: {
      authorization: `Bearer ${OPERATOR}`,
      "idempotency-key": "create-run-033",
    },
    payload: { runId: "run-033" },
  });
  expect(created.statusCode).toBe(201);
  return { app, artifactRoot, databasePath };
}

function authority(token: string, observerView = false) {
  return {
    authorization: `Bearer ${token}`,
    ...(observerView ? { "x-code-nest-observer-view": "1" } : {}),
  };
}

describe("audited observer modes", () => {
  it("keeps browser evidence sealed until one permanent idempotent unblind event", async () => {
    const { app, artifactRoot, databasePath } = await fixture();
    const store = await ArtifactStore.open(artifactRoot);
    const privateArtifact = await store.put({
      runId: "run-033",
      bytes: Buffer.from("private participant evidence"),
      mediaType: "text/plain",
      redactedPreview: "private evidence",
      visibility: { class: "participant_private", recipientIds: ["player-a"] },
    });
    const path = `/runs/run-033/artifacts/${privateArtifact.digest}`;

    const clean = await app.inject({
      method: "GET",
      url: path,
      headers: authority(OPERATOR, true),
    });
    expect(clean.statusCode).toBe(404);
    const infrastructureOperator = await app.inject({
      method: "GET",
      url: path,
      headers: authority(OPERATOR),
    });
    expect(infrastructureOperator.statusCode).toBe(200);

    const forbidden = await app.inject({
      method: "POST",
      url: "/runs/run-033/observer-mode/unblind",
      headers: {
        ...authority(OBSERVER),
        "idempotency-key": "unblind-033",
      },
      payload: {},
    });
    expect(forbidden.statusCode).toBe(401);

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await app.inject({
        method: "POST",
        url: "/runs/run-033/observer-mode/unblind",
        headers: {
          ...authority(OPERATOR),
          "idempotency-key": "unblind-033",
        },
        payload: {},
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        mode: "unblinded",
        benchmarkEligible: false,
        unblindedEventId: "event-2",
      });
    }

    const state = await app.inject({
      method: "GET",
      url: "/runs/run-033/observer-mode",
      headers: authority(OBSERVER),
    });
    expect(state.json()).toMatchObject({ mode: "unblinded", benchmarkEligible: false });
    const unblinded = await app.inject({
      method: "GET",
      url: path,
      headers: authority(OPERATOR, true),
    });
    expect(unblinded.statusCode).toBe(200);
    expect(unblinded.body).toBe("private participant evidence");

    await app.close();
    const ledger = EventLedger.open(databasePath);
    const auditEvents = ledger.listEvents("run-033").filter(({ kind }) =>
      kind === "observer_unblinded"
    );
    expect(auditEvents).toHaveLength(1);
    expect(auditEvents[0]).toMatchObject({
      visibility: { class: "public" },
      payload: {
        mode: "unblinded",
        benchmarkEligible: false,
        intervention: "operator_unblinding",
      },
    });
    expect(JSON.stringify(auditEvents[0])).not.toContain(OPERATOR);
    ledger.close();
  });

  it("rejects malformed, body-bearing, and absent-run mutations without audit writes", async () => {
    const { app, databasePath } = await fixture();
    const cases = [
      { url: "/runs/run-033/observer-mode/unblind", headers: authority(OPERATOR), payload: {} },
      {
        url: "/runs/run-033/observer-mode/unblind",
        headers: { ...authority(OPERATOR), "idempotency-key": "unblind-body" },
        payload: { reason: "show me secrets" },
      },
      {
        url: "/runs/missing-run/observer-mode/unblind",
        headers: { ...authority(OPERATOR), "idempotency-key": "unblind-missing" },
        payload: {},
      },
    ];
    const statuses: number[] = [];
    for (const value of cases) {
      statuses.push((await app.inject({ method: "POST", ...value })).statusCode);
    }
    expect(statuses).toEqual([400, 400, 404]);
    await app.close();
    const ledger = EventLedger.open(databasePath);
    expect(ledger.listEvents("run-033").filter(({ kind }) =>
      kind === "observer_unblinded"
    )).toEqual([]);
    ledger.close();
  });

  it("unlocks permitted post-match research data without exposing operator-private evidence", async () => {
    const { app, artifactRoot, databasePath } = await fixture();
    await app.close();
    const ledger = EventLedger.open(databasePath);
    ledger.appendCommandEvent("reveal-033", {
      schemaVersion: EVENT_SCHEMA_VERSION,
      eventId: "event-reveal",
      runId: "run-033",
      recordedAt: "2026-09-18T12:30:00.000Z",
      actor: { kind: "controller", id: "match-resolution" },
      context: { round: 3, phase: "complete" },
      kind: "match.roles_revealed",
      payload: { roles: [] },
      visibility: { class: "post_reveal" },
      causationId: "reveal-033",
      correlationId: "match-033",
      parentEventIds: ["event-1"],
      artifactDigests: [],
      resourceCost: {},
    });
    ledger.close();
    const reopened = buildApp({
      databasePath,
      artifactRoot,
      operatorToken: OPERATOR,
      observerToken: OBSERVER,
      logger: false,
    });
    const store = await ArtifactStore.open(artifactRoot);
    const research = await store.put({
      runId: "run-033",
      bytes: Buffer.from("revealed role evidence"),
      mediaType: "text/plain",
      redactedPreview: "revealed",
      visibility: { class: "covert", recipientIds: ["player-a"] },
    });
    const infrastructure = await store.put({
      runId: "run-033",
      bytes: Buffer.from("host-only data"),
      mediaType: "text/plain",
      redactedPreview: "host-only",
      visibility: { class: "operator_private" },
    });
    const mode = await reopened.inject({
      method: "GET",
      url: "/runs/run-033/observer-mode",
      headers: authority(OBSERVER),
    });
    expect(mode.json()).toMatchObject({
      mode: "post_match_reveal",
      benchmarkEligible: true,
      revealedEventId: "event-reveal",
    });
    const visible = await reopened.inject({
      method: "GET",
      url: `/runs/run-033/artifacts/${research.digest}`,
      headers: authority(OBSERVER),
    });
    const hidden = await reopened.inject({
      method: "GET",
      url: `/runs/run-033/artifacts/${infrastructure.digest}`,
      headers: authority(OBSERVER),
    });
    expect(visible.statusCode).toBe(200);
    expect(hidden.statusCode).toBe(404);
    await reopened.close();
  });
});
