import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseObservabilityEvent } from "@code-nest/protocol";
import { afterEach, describe, expect, it } from "vitest";

import { ArtifactStore } from "../artifacts/store.js";
import { EventLedger } from "../ledger/ledger.js";
import { SecretRedactor } from "../redaction/index.js";
import { EventLedgerObservabilityStore } from "./adapters/event-ledger-observability-store.js";
import { RecordObservationService } from "./application/record-observation.js";
import {
  ObservabilityError,
  type RecordObservationRequest,
} from "./domain/observation.js";

const roots: string[] = [];
const ledgers: EventLedger[] = [];
const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);

async function harness(secretPatterns: readonly string[] = []) {
  const root = await mkdtemp(join(tmpdir(), "code-nest-observability-"));
  roots.push(root);
  const ledger = EventLedger.open(join(root, "events.sqlite"), {
    secretPatterns,
  });
  ledgers.push(ledger);
  ledger.appendCommandEvent("create-run", {
    schemaVersion: "1.0",
    eventId: "run-created",
    runId: "run-001",
    recordedAt: "2026-09-18T12:00:00.000Z",
    actor: { kind: "operator", id: "operator" },
    context: { round: 0, phase: null },
    kind: "run.created",
    payload: {},
    visibility: { class: "public" },
    causationId: "create-run",
    correlationId: "run-001",
    parentEventIds: [],
    artifactDigests: [],
    resourceCost: {},
  });
  const artifacts = await ArtifactStore.open(join(root, "artifacts"));
  let eventNumber = 0;
  const redactor = new SecretRedactor(secretPatterns);
  const store = new EventLedgerObservabilityStore(ledger, artifacts, {
    createEventId: () => `observed-${++eventNumber}`,
    now: () => new Date(`2026-09-18T12:00:0${eventNumber}.000Z`),
    redactText: (value) => String(redactor.redact(value)),
  });
  return {
    artifacts,
    ledger,
    service: new RecordObservationService(store),
  };
}

function request(
  observationId: string,
  observation: RecordObservationRequest["observation"],
  source: RecordObservationRequest["source"] = {
    kind: "participant",
    id: "player-a",
  },
): RecordObservationRequest {
  return {
    runId: "run-001",
    observationId,
    participantId: "player-a",
    source,
    context: { round: 1, phase: "work" },
    observation,
  };
}

async function expectError(
  operation: Promise<unknown>,
  code: ObservabilityError["code"],
): Promise<void> {
  try {
    await operation;
    throw new Error("Expected ObservabilityError");
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(ObservabilityError);
    if (error instanceof ObservabilityError) expect(error.code).toBe(code);
  }
}

afterEach(async () => {
  for (const ledger of ledgers.splice(0)) ledger.close();
  for (const root of roots.splice(0)) {
    await rm(root, { force: true, recursive: true });
  }
});

describe("Observatory recording and working memory", () => {
  it("persists each private fact and binds frame and memory artifacts", async () => {
    const secret = "credential-must-not-persist";
    const { artifacts, ledger, service } = await harness([secret]);
    const observations: RecordObservationRequest[] = [
      request("activity", {
        kind: "activity",
        state: "working",
        summary: "Reviewing the access boundary.",
        thinking: "must not persist",
      } as RecordObservationRequest["observation"]),
      request("rationale", {
        kind: "rationale",
        body: "I selected the smallest policy-preserving change.",
      }),
      request(
        "provider-summary",
        {
          kind: "provider_rationale",
          body: "Provider supplied a bounded summary.",
          provider: "openai",
          model: "gpt-5.6-luna",
        },
        { kind: "runtime", id: "omp-a" },
      ),
      request(
        "tool",
        {
          kind: "tool",
          toolCallId: "tool-001",
          toolName: "shell",
          status: "completed",
          summary: "Focused tests passed.",
        },
        { kind: "runtime", id: "omp-a" },
      ),
      request(
        "frame",
        {
          kind: "computer_frame",
          frameId: "frame-001",
          captureReason: "action",
          frameSequence: 1,
          frame: {
            status: "visible",
            bytes: png,
            width: 1,
            height: 1,
            redactionStatus: "redacted",
          },
        },
        { kind: "runtime", id: "omp-a" },
      ),
      request("memory", {
        kind: "memory",
        reason: "agent_consolidation",
        summary: "Saved the current hypothesis.",
        content: `# Working memory\nCheck ${secret} next.`,
      }),
    ];

    for (const observation of observations) await service.record(observation);

    const events = ledger.listEvents("run-001").slice(1);
    expect(events).toHaveLength(6);
    for (const event of events) {
      const parsed = parseObservabilityEvent(event);
      expect(parsed.ok).toBe(true);
      expect(event.visibility).toEqual({
        class: "participant_private",
        recipientIds: ["player-a"],
      });
    }
    expect(JSON.stringify(events)).not.toContain("must not persist");
    expect(JSON.stringify(events)).not.toContain(secret);
    const artifactEvents = events.filter(
      (event) => event.artifactDigests.length === 1,
    );
    expect(artifactEvents).toHaveLength(2);
    for (const event of artifactEvents) {
      const digest = event.artifactDigests[0];
      expect(digest).toBeDefined();
      expect(
        await artifacts.read({
          runId: "run-001",
          digest: digest ?? "",
          audience: { kind: "observer", mode: "clean" },
          revealState: "sealed",
        }),
      ).toBeUndefined();
      expect(
        await artifacts.read({
          runId: "run-001",
          digest: digest ?? "",
          audience: { kind: "observer", mode: "unblinded" },
          revealState: "sealed",
        }),
      ).toBeDefined();
    }
    const memory = await service.readOwnMemory({
      runId: "run-001",
      requesterId: "player-a",
      participantId: "player-a",
    });
    expect(memory?.content).toContain("[REDACTED]");
    expect(memory?.content).not.toContain(secret);
  });

  it("chains concurrent memory revisions and returns only the owner's latest", async () => {
    const { artifacts, ledger, service } = await harness();
    await Promise.all([
      service.record(
        request("memory-a", {
          kind: "memory",
          reason: "agent_consolidation",
          summary: "First note.",
          content: "first",
        }),
      ),
      service.record(
        request("memory-b", {
          kind: "memory",
          reason: "round_transition",
          summary: "Second note.",
          content: "second",
        }),
      ),
    ]);

    const memoryEvents = ledger
      .listEvents("run-001")
      .filter((event) => event.kind === "memory.updated");
    expect(memoryEvents.map((event) => event.payload)).toEqual([
      expect.objectContaining({ revision: 1, previousDigest: null }),
      expect.objectContaining({
        revision: 2,
        previousDigest: memoryEvents[0]?.artifactDigests[0],
      }),
    ]);
    const latest = await service.readOwnMemory({
      runId: "run-001",
      requesterId: "player-a",
      participantId: "player-a",
    });
    expect(latest).toMatchObject({
      revision: 2,
      content: expect.stringMatching(/^(first|second)$/),
    });
    await expectError(
      service.readOwnMemory({
        runId: "run-001",
        requesterId: "player-b",
        participantId: "player-a",
      }),
      "MEMORY_ACCESS_DENIED",
    );
    expect(
      await artifacts.read({
        runId: "run-001",
        digest: latest?.digest ?? "",
        audience: { kind: "participant", participantId: "player-b" },
        revealState: "sealed",
      }),
    ).toBeUndefined();
  });

  it("deduplicates exact retries and rejects changed identity reuse", async () => {
    const { ledger, service } = await harness();
    const original = request("activity", {
      kind: "activity",
      state: "testing",
      summary: "Running focused tests.",
    });
    expect(await service.record(original)).toMatchObject({ duplicate: false });
    expect(await service.record(original)).toMatchObject({ duplicate: true });
    await expectError(
      service.record(
        request("activity", {
          kind: "activity",
          state: "failed",
          summary: "Changed retry.",
        }),
      ),
      "OBSERVATION_CONFLICT",
    );
    expect(ledger.listEvents("run-001")).toHaveLength(2);
  });

  it("rejects invalid source ownership and malformed artifacts", async () => {
    const { service } = await harness();
    await expectError(
      service.record(
        request(
          "bad-tool",
          {
            kind: "tool",
            toolCallId: "tool-001",
            toolName: "shell",
            status: "started",
            summary: null,
          },
          { kind: "participant", id: "player-a" },
        ),
      ),
      "INVALID_OBSERVATION",
    );
    await expectError(
      service.record(
        request(
          "bad-frame",
          {
            kind: "computer_frame",
            frameId: "frame-001",
            captureReason: "heartbeat",
            frameSequence: 1,
            frame: {
              status: "visible",
              bytes: Uint8Array.from([1, 2, 3]),
              width: 1,
              height: 1,
              redactionStatus: "clear",
            },
          },
          { kind: "runtime", id: "omp-a" },
        ),
      ),
      "INVALID_OBSERVATION",
    );
  });
});
