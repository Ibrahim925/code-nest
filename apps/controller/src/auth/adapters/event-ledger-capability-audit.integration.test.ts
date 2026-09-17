import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  COMMAND_PROTOCOL_VERSION,
  EVENT_SCHEMA_VERSION,
  type CommandEnvelope,
} from "@code-nest/protocol";
import { afterEach, describe, expect, it } from "vitest";

import { CapabilityDeniedError, CapabilityService } from "../application/capabilities";
import { CapabilityAuditError } from "../application/ports/capability-audit";
import { EventLedger, type EventDraft } from "../../ledger/ledger";
import { EventLedgerCapabilityAudit } from "./event-ledger-capability-audit";

const temporaryDirectories: string[] = [];
const openLedgers: EventLedger[] = [];
const BEARER = "cn_cap_abcdefghijklmnopqrstuvwxyz0123456789";

async function createLedger(): Promise<EventLedger> {
  const directory = await mkdtemp(join(tmpdir(), "code-nest-capability-"));
  temporaryDirectories.push(directory);
  const ledger = EventLedger.open(join(directory, "events.sqlite"));
  openLedgers.push(ledger);
  return ledger;
}

function rejectedCommand(): CommandEnvelope {
  return {
    protocolVersion: COMMAND_PROTOCOL_VERSION,
    commandId: "request-001",
    runId: "run-other",
    actor: { kind: "participant", id: "player-a" },
    capability: { tokenId: "capability-001" },
    kind: "message.publish",
    payload: { body: "Wrong run." },
  };
}

function runCreatedDraft(): EventDraft {
  return {
    schemaVersion: EVENT_SCHEMA_VERSION,
    eventId: "run-created",
    runId: "run-001",
    recordedAt: "2026-09-17T15:59:00.000Z",
    actor: { kind: "operator", id: "local-operator" },
    context: { round: null, phase: null },
    kind: "run.created",
    payload: { action: "create" },
    visibility: { class: "public" },
    causationId: "create-run",
    correlationId: "create-run",
    parentEventIds: [],
    artifactDigests: [],
    resourceCost: {},
  };
}

afterEach(async () => {
  for (const ledger of openLedgers.splice(0)) ledger.close();
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { force: true, recursive: true });
  }
});

describe("event-ledger capability audit", () => {
  it("refuses to create phantom run state for an audit entry", async () => {
    const ledger = await createLedger();
    const audit = new EventLedgerCapabilityAudit(ledger);
    const service = new CapabilityService({
      audit,
      now: () => new Date("2026-09-17T16:00:00.000Z"),
      createTokenId: () => "capability-001",
      createBearerToken: () => BEARER,
      reservedBearerTokens: ["operator-secret", "observer-secret"],
    });

    expect(() =>
      service.issue({
        runId: "missing-run",
        participantId: "player-a",
        actions: ["message.publish"],
        expiresAt: new Date("2026-09-17T16:05:00.000Z"),
      }),
    ).toThrowError(CapabilityAuditError);
    expect(ledger.listEvents("missing-run")).toEqual([]);
  });

  it("records issue, rejection, and revocation without bearer material", async () => {
    const ledger = await createLedger();
    ledger.appendCommandEvent("create-run", runCreatedDraft());
    let identifier = 0;
    const audit = new EventLedgerCapabilityAudit(ledger, {
      createAuditId: () => `audit-${++identifier}`,
      createEventId: () => `event-${identifier}`,
    });
    const service = new CapabilityService({
      audit,
      now: () => new Date("2026-09-17T16:00:00.000Z"),
      createTokenId: () => "capability-001",
      createBearerToken: () => BEARER,
      reservedBearerTokens: ["operator-secret", "observer-secret"],
    });

    const capability = service.issue({
      runId: "run-001",
      participantId: "player-a",
      actions: ["message.publish"],
      expiresAt: new Date("2026-09-17T16:05:00.000Z"),
    });
    expect(() =>
      service.authorize(capability.bearerToken, rejectedCommand()),
    ).toThrowError(CapabilityDeniedError);
    expect(service.revoke(capability.tokenId, "operator_cancelled")).toBe(true);

    const events = ledger
      .listEvents("run-001")
      .filter((event) => event.kind.startsWith("capability."));
    expect(events.map((event) => event.kind)).toEqual([
      "capability.issued",
      "capability.rejected",
      "capability.revoked",
    ]);
    expect(events.every((event) => event.visibility.class === "operator_private")).toBe(
      true,
    );
    expect(events[1]?.payload).toMatchObject({
      reason: "run_mismatch",
      requestCommandId: "request-001",
      claimedRunId: "run-other",
    });
    expect(JSON.stringify(events)).not.toContain(BEARER);
    expect(JSON.stringify(events)).not.toContain("observer-secret");
  });
});
