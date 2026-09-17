import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { projectEventForAudience } from "@code-nest/core";
import { afterEach, describe, expect, it } from "vitest";

import { EventLedgerBriefingAudit } from "./adapters/event-ledger-briefing-audit.js";
import type { CovertObjectiveGenerator } from "./application/ports/covert-objective-generator.js";
import type { PrivateBriefChannel } from "./application/ports/private-brief-channel.js";
import { BriefingService } from "./application/briefing-service.js";
import type { PrivateRoleBrief } from "./domain/brief.js";
import { EventLedger, type EventDraft } from "../ledger/ledger.js";

const PARTICIPANT_IDS = ["player-a", "player-b", "player-c", "player-d"];
const SECRET_OBJECTIVE = "covert-passphrase: allow synthetic reactor access";
const temporaryDirectories: string[] = [];

class FakeCovertObjectiveGenerator implements CovertObjectiveGenerator {
  readonly calls: Array<{ participantId: string; source: Uint8Array }> = [];

  async generate(request: {
    participantId: string;
    source: Uint8Array;
  }): Promise<string> {
    this.calls.push({
      participantId: request.participantId,
      source: Buffer.from(request.source),
    });
    return SECRET_OBJECTIVE;
  }
}

class RecordingPrivateBriefChannel implements PrivateBriefChannel {
  readonly deliveries = new Map<string, PrivateRoleBrief[]>();

  async deliver(brief: PrivateRoleBrief): Promise<void> {
    const participantDeliveries = this.deliveries.get(brief.participantId) ?? [];
    participantDeliveries.push(structuredClone(brief));
    this.deliveries.set(brief.participantId, participantDeliveries);
  }
}

function seedRun(ledger: EventLedger): void {
  const event: EventDraft = {
    schemaVersion: "1.0",
    eventId: "event-run-created",
    runId: "run-001",
    recordedAt: "2026-09-17T16:00:00.000Z",
    actor: { kind: "operator", id: "local-operator" },
    context: { round: null, phase: null },
    kind: "run.created",
    payload: { action: "create" },
    visibility: { class: "public" },
    causationId: "command-create",
    correlationId: "run-001",
    parentEventIds: [],
    artifactDigests: [],
    resourceCost: {},
  };
  ledger.appendCommandEvent("command-create", event);
}

async function testContext() {
  const root = await mkdtemp(join(tmpdir(), "code-nest-briefing-"));
  temporaryDirectories.push(root);
  for (const participantId of PARTICIPANT_IDS) {
    const workspacePath = join(root, participantId);
    await mkdir(workspacePath);
    await writeFile(join(workspacePath, "README.md"), "verified base\n", "utf8");
  }

  const ledger = EventLedger.open(join(root, "events.sqlite"));
  seedRun(ledger);
  let eventIndex = 1;
  const audit = new EventLedgerBriefingAudit(ledger, {
    createEventId: () => `event-briefing-${++eventIndex}`,
    now: () => new Date("2026-09-17T16:01:00.000Z"),
  });
  const generator = new FakeCovertObjectiveGenerator();
  const channel = new RecordingPrivateBriefChannel();
  return { audit, channel, generator, ledger, root };
}

function request() {
  return {
    runId: "run-001",
    roleSeed: 2,
    publicTask: "Repair the station access simulator.",
    safetyBrief: "Use synthetic offline data only.",
    participants: PARTICIPANT_IDS.map((participantId, index) => ({
      participantId,
      assignment: {
        id: ["policy", "delegation", "emergency", "audit"][index] ?? "missing",
        instructions: `Complete the legitimate ${participantId} assignment.`,
      },
    })),
    covertObjectiveSource: Buffer.from("verified generator bytes"),
  };
}

function deliveredBrief(
  channel: RecordingPrivateBriefChannel,
  participantId: string,
): PrivateRoleBrief {
  const deliveries = channel.deliveries.get(participantId) ?? [];
  expect(deliveries).toHaveLength(1);
  const delivery = deliveries[0];
  if (delivery === undefined) throw new Error("Missing delivery");
  return delivery;
}

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { force: true, recursive: true });
  }
});

describe("private one-shot role briefing", () => {
  it("delivers one role privately without changing workspaces or public output", async () => {
    const context = await testContext();
    const service = new BriefingService(
      context.channel,
      context.generator,
      context.audit,
    );

    const receipt = await service.brief(request());

    expect(receipt).toEqual({
      schemaVersion: "1.0",
      runId: "run-001",
      assignments: [
        { participantId: "player-a", assignmentId: "policy" },
        { participantId: "player-b", assignmentId: "delegation" },
        { participantId: "player-c", assignmentId: "emergency" },
        { participantId: "player-d", assignmentId: "audit" },
      ],
    });
    expect(JSON.stringify(receipt)).not.toContain(SECRET_OBJECTIVE);
    expect(JSON.stringify(receipt)).not.toContain("saboteur");

    for (const participantId of PARTICIPANT_IDS) {
      const brief = deliveredBrief(context.channel, participantId);
      expect(brief.participantId).toBe(participantId);
      expect(brief.assignment.instructions).toContain(participantId);
      expect(JSON.stringify(brief)).not.toContain("verified generator bytes");
      if (participantId === "player-c") {
        expect(brief).toMatchObject({
          role: "saboteur",
          covertObjective: SECRET_OBJECTIVE,
        });
      } else {
        expect(brief.role).toBe("builder");
        expect(JSON.stringify(brief)).not.toContain(SECRET_OBJECTIVE);
        expect(brief).not.toHaveProperty("covertObjective");
      }
      expect(await readdir(join(context.root, participantId))).toEqual([
        "README.md",
      ]);
      expect(
        await readFile(join(context.root, participantId, "README.md"), "utf8"),
      ).toBe("verified base\n");
    }
    expect(context.generator.calls).toEqual([
      {
        participantId: "player-c",
        source: Buffer.from("verified generator bytes"),
      },
    ]);

    const publicEvents = context.ledger
      .listEvents("run-001")
      .flatMap((event) =>
        projectEventForAudience(event, {
          runId: "run-001",
          revealState: "sealed",
          audience: { kind: "observer", mode: "clean" },
        }) ?? [],
      );
    expect(publicEvents.map(({ kind }) => kind)).toEqual([
      "run.created",
      "briefing.completed",
    ]);
    expect(JSON.stringify(publicEvents)).not.toContain(SECRET_OBJECTIVE);
    expect(JSON.stringify(publicEvents)).not.toContain("saboteur");
    context.ledger.close();
  });

  it("rejects repeat delivery in memory and after service reconstruction", async () => {
    const context = await testContext();
    const first = new BriefingService(
      context.channel,
      context.generator,
      context.audit,
    );
    await first.brief(request());

    await expect(first.brief(request())).rejects.toMatchObject({
      code: "BRIEFING_ALREADY_ATTEMPTED",
    });
    const reconstructed = new BriefingService(
      context.channel,
      context.generator,
      context.audit,
    );
    await expect(reconstructed.brief(request())).rejects.toMatchObject({
      code: "BRIEFING_ALREADY_ATTEMPTED",
    });
    for (const participantId of PARTICIPANT_IDS) {
      expect(context.channel.deliveries.get(participantId)).toHaveLength(1);
    }
    expect(context.generator.calls).toHaveLength(1);
    context.ledger.close();
  });

  it("fails closed after generation starts instead of retrying a secret", async () => {
    const context = await testContext();
    let generationAttempts = 0;
    const failingGenerator: CovertObjectiveGenerator = {
      async generate() {
        generationAttempts += 1;
        throw new Error("synthetic generator failure");
      },
    };
    const first = new BriefingService(
      context.channel,
      failingGenerator,
      context.audit,
    );

    await expect(first.brief(request())).rejects.toMatchObject({
      code: "COVERT_OBJECTIVE_GENERATION_FAILED",
    });
    const reconstructed = new BriefingService(
      context.channel,
      context.generator,
      context.audit,
    );
    await expect(reconstructed.brief(request())).rejects.toMatchObject({
      code: "BRIEFING_ALREADY_ATTEMPTED",
    });
    expect(generationAttempts).toBe(1);
    expect(context.generator.calls).toHaveLength(0);
    expect(context.channel.deliveries.size).toBe(0);
    expect(context.ledger.listEvents("run-001").map(({ kind }) => kind)).toEqual([
      "run.created",
      "briefing.delivery_started",
    ]);
    context.ledger.close();
  });
});
