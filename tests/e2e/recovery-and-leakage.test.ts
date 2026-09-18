import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../../apps/controller/src/app.js";
import { ArtifactStore } from "../../apps/controller/src/artifacts/store.js";
import { EventLedgerRecoveryJournal } from "../../apps/controller/src/recovery/adapters/event-ledger-recovery-journal.js";
import { RecordRecoveryOutcomeService } from "../../apps/controller/src/recovery/application/record-recovery-outcome.js";
import type { RecoverySignal } from "../../apps/controller/src/recovery/domain/recovery-outcome.js";
import { EventLedgerRunStore } from "../../apps/controller/src/runs/adapters/event-ledger-run-store.js";
import { RunLifecycleService } from "../../apps/controller/src/runs/application/run-lifecycle.js";
import { EventLedger, type EventDraft } from "../../apps/controller/src/ledger/ledger.js";
import {
  createActivityFeedState,
  projectActivityFeed,
} from "../../apps/web/src/observatory/application/project-activity-feed.js";
import {
  parseReplayBundle,
  type RunSetupConfiguration,
} from "../../packages/protocol/src/index.js";

const RUN_ID = "recovery-hardening";
const SECRET = "covert-marker-never-serialize";
const OPERATOR = "recovery-operator-token";
const OBSERVER = "recovery-observer-token";
const HASH = `sha256:${"a".repeat(64)}` as const;
const roots: string[] = [];

function configuration(): RunSetupConfiguration {
  return {
    schemaVersion: "1.0",
    runId: RUN_ID,
    scenario: {
      id: "station-access",
      manifestDigest: HASH,
      repositoryRevision: "b".repeat(40),
      participantImage: `code-nest/participant@${HASH}`,
      evaluatorImage: `code-nest/evaluator@${HASH}`,
    },
    adapters: ["a", "b", "c", "d"].map((id) => ({
      participantId: `player-${id}`,
      adapterId: "fake-scripted",
      executionMode: "split" as const,
      modelDisclosure: "Deterministic fixture",
    })),
    seed: 47,
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

function lifecycle(ledger: EventLedger, createEventId: () => string): RunLifecycleService {
  return new RunLifecycleService({
    store: new EventLedgerRunStore(ledger),
    createEventId,
    now: () => new Date("2026-09-18T16:00:00.000Z"),
  });
}

function evidenceDraft(input: {
  readonly eventId: string;
  readonly kind: string;
  readonly payload: EventDraft["payload"];
  readonly visibility: EventDraft["visibility"];
  readonly artifactDigests: readonly string[];
}): EventDraft {
  return {
    schemaVersion: "1.0",
    eventId: input.eventId,
    runId: RUN_ID,
    recordedAt: "2026-09-18T16:01:00.000Z",
    actor: { kind: "controller", id: "recovery-fixture" },
    context: { round: null, phase: null },
    kind: input.kind,
    payload: input.payload,
    visibility: input.visibility,
    causationId: `command-${input.eventId}`,
    correlationId: RUN_ID,
    parentEventIds: [],
    artifactDigests: [...input.artifactDigests],
    resourceCost: {},
  };
}

const signals: readonly RecoverySignal[] = [
  { kind: "adapter_exit", participantId: "player-a", exitCode: 137, outOfMemory: false },
  { kind: "adapter_exit", participantId: "player-b", exitCode: 137, outOfMemory: true },
  { kind: "model_timeout", participantId: "player-c" },
  { kind: "invalid_input", boundary: "protocol" },
  { kind: "manual_intervention", action: "retry" },
  { kind: "operator_cancellation" },
  { kind: "policy_violation", participantId: "player-d" },
  { kind: "cleanup_failure", resource: "network" },
];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("recovery and information-leakage hardening", () => {
  it("recovers from durable state with distinct safe outcomes and no protected serialization", async () => {
    const root = await mkdtemp(join(tmpdir(), "code-nest-recovery-"));
    roots.push(root);
    const databasePath = join(root, "events.sqlite");
    const artifactRoot = join(root, "artifacts");
    let nextEvent = 0;
    const createEventId = () => `recovery-event-${++nextEvent}`;
    const artifacts = await ArtifactStore.open(artifactRoot);
    const publicArtifact = await artifacts.put({
      runId: RUN_ID,
      bytes: Buffer.from("safe recovery evidence"),
      mediaType: "text/plain",
      redactedPreview: "safe recovery evidence",
      visibility: { class: "public" },
    });
    const covertArtifact = await artifacts.put({
      runId: RUN_ID,
      bytes: Buffer.from(SECRET),
      mediaType: "text/plain",
      redactedPreview: "sealed recovery evidence",
      visibility: { class: "covert", recipientIds: ["player-a"] },
    });

    let ledger = EventLedger.open(databasePath, { secretPatterns: [SECRET] });
    lifecycle(ledger, createEventId).create(RUN_ID, "create-recovery-run", configuration());
    for (const artifact of [
      { eventId: "public-recovery-evidence", covert: false, digest: publicArtifact.digest },
      { eventId: "covert-recovery-evidence", covert: true, digest: covertArtifact.digest },
    ]) {
      const visibility: EventDraft["visibility"] = artifact.covert
        ? { class: "covert", recipientIds: ["player-a"] }
        : { class: "public" };
      const draft = evidenceDraft({
        eventId: artifact.eventId,
        kind: "recovery.evidence_recorded",
        payload: { detail: artifact.covert ? SECRET : "safe evidence" },
        visibility,
        artifactDigests: [artifact.digest],
      });
      ledger.appendCommandEvent(String(draft.causationId), draft);
    }
    const initialRecovery = new RecordRecoveryOutcomeService(
      new EventLedgerRecoveryJournal(ledger, {
        createEventId,
        now: () => new Date("2026-09-18T16:02:00.000Z"),
      }),
    );
    const initialReceipts = [];
    for (const [index, signal] of signals.entries()) {
      initialReceipts.push(await initialRecovery.record({
        runId: RUN_ID,
        commandId: `recovery-command-${index + 1}`,
        signal,
      }));
    }
    expect(new Set(initialReceipts.map(({ outcome }) => outcome.reason))).toEqual(new Set([
      "adapter_crash", "out_of_memory", "model_timeout", "invalid_input",
      "manual_intervention", "operator_cancellation", "policy_violation", "cleanup_failure",
    ]));
    expect(initialReceipts.every(({ duplicate }) => !duplicate)).toBe(true);
    const lastDurableSequence = ledger.listEvents(RUN_ID).at(-1)?.sequence;
    if (lastDurableSequence === undefined) throw new Error("Recovery fixture has no durable state.");
    ledger.close();

    ledger = EventLedger.open(databasePath, { secretPatterns: [SECRET] });
    expect(lifecycle(ledger, createEventId).get(RUN_ID).status).toBe("running");
    const reconstructed = new RecordRecoveryOutcomeService(
      new EventLedgerRecoveryJournal(ledger, {
        createEventId,
        now: () => new Date("2026-09-18T16:03:00.000Z"),
      }),
    );
    const restartRequest = {
      runId: RUN_ID,
      commandId: "recovery-command-restart",
      signal: { kind: "controller_restart", lastDurableSequence } as const,
    };
    const restarted = await reconstructed.record(restartRequest);
    ledger.close();

    ledger = EventLedger.open(databasePath, { secretPatterns: [SECRET] });
    const afterSecondRestart = new RecordRecoveryOutcomeService(
      new EventLedgerRecoveryJournal(ledger, {
        createEventId,
        now: () => new Date("2026-09-18T16:04:00.000Z"),
      }),
    );
    const duplicate = await afterSecondRestart.record(restartRequest);
    expect(duplicate).toMatchObject({ eventId: restarted.eventId, duplicate: true });
    await expect(afterSecondRestart.record({
      ...restartRequest,
      signal: { kind: "manual_intervention", action: "pause" },
    })).rejects.toThrow("idempotency key was reused");
    lifecycle(ledger, createEventId).cancel(RUN_ID, "cancel-after-recovery");
    const events = ledger.listEvents(RUN_ID);
    expect(events.map(({ sequence }) => sequence)).toEqual(
      events.map((_, index) => index + 1),
    );
    expect(events.filter(({ kind }) => kind === "recovery.outcome_recorded")).toHaveLength(9);
    expect(JSON.stringify(events)).not.toContain(SECRET);
    ledger.close();

    const raw = new DatabaseSync(databasePath, { readOnly: true });
    const rows = raw.prepare("SELECT envelope_json FROM ledger_events ORDER BY sequence").all();
    raw.close();
    expect(JSON.stringify(rows)).not.toContain(SECRET);
    expect(JSON.stringify(rows)).toContain("[REDACTED]");

    const app = buildApp({
      databasePath,
      artifactRoot,
      operatorToken: OPERATOR,
      observerToken: OBSERVER,
      secretPatterns: [SECRET],
      logger: false,
    });
    const headers = { authorization: `Bearer ${OBSERVER}` };
    const publicRead = await app.inject({
      method: "GET",
      url: `/runs/${RUN_ID}/artifacts/${publicArtifact.digest}`,
      headers,
    });
    const covertRead = await app.inject({
      method: "GET",
      url: `/runs/${RUN_ID}/artifacts/${covertArtifact.digest}`,
      headers,
    });
    expect(publicRead.statusCode).toBe(200);
    expect(publicRead.body).toContain("safe recovery evidence");
    expect(covertRead.statusCode).toBe(404);
    expect(covertRead.body).not.toContain(SECRET);

    const invalid = await app.inject({
      method: "POST",
      url: `/runs/${RUN_ID}/pause`,
      headers: { authorization: `Bearer ${OPERATOR}`, "idempotency-key": SECRET },
      payload: { untrusted: SECRET },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.body).not.toContain(SECRET);
    const replayResponse = await app.inject({
      method: "GET",
      url: `/runs/${RUN_ID}/replay`,
      headers,
    });
    expect(replayResponse.statusCode).toBe(200);
    expect(replayResponse.body).not.toContain(SECRET);
    expect(replayResponse.body).not.toContain(covertArtifact.digest);
    const parsed = parseReplayBundle(replayResponse.json());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error(parsed.error.message);
    expect(parsed.value.deliveries.map(({ deliverySequence }) =>
      deliverySequence)).toEqual(
      parsed.value.deliveries.map((_, index) => index + 1),
    );
    expect(new Set(parsed.value.deliveries
      .filter(({ event }) => event.kind === "recovery.outcome_recorded")
      .map(({ event }) => (event.payload as { reason: string }).reason)).size).toBe(9);
    const activity = parsed.value.deliveries.reduce(
      (state, delivery) => projectActivityFeed(state, {
        deliverySequence: delivery.deliverySequence,
        eventId: delivery.event.eventId,
        kind: delivery.event.kind,
        event: delivery.event,
      }),
      createActivityFeedState(),
    );
    expect(activity.items.filter(({ category }) => category === "recovery")).toHaveLength(9);
    expect(activity.items.find(({ title }) => title === "Recovery · out of memory"))
      .toMatchObject({ verification: "trusted", participantId: "player-b" });
    await app.close();
  });
});
