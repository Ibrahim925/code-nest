import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { projectEventForAudience } from "@code-nest/core";
import { EVENT_SCHEMA_VERSION, type JsonValue } from "@code-nest/protocol";

import {
  EventLedgerBeliefEvidenceReader,
  EventLedgerBeliefJournal,
} from "./adapters/event-ledger-beliefs.js";
import {
  BeliefApplicationError,
  BeliefService,
  type SubmitPrivateBeliefRequest,
} from "./application/belief-service.js";
import type {
  BeliefContextReader,
  BeliefSubmissionContext,
} from "./application/ports/belief-ports.js";
import { EventLedger, type EventDraft } from "../ledger/ledger.js";

const paths: string[] = [];
const ledgers: EventLedger[] = [];
const roster = ["player-a", "player-b", "player-c", "player-d"] as const;

afterEach(() => {
  for (const ledger of ledgers.splice(0)) ledger.close();
  for (const path of paths.splice(0)) rmSync(path, { recursive: true, force: true });
});

class MutableContextReader implements BeliefContextReader {
  constructor(public value: BeliefSubmissionContext | undefined) {}
  read(): BeliefSubmissionContext | undefined {
    return this.value;
  }
}

function openLedger(): EventLedger {
  const path = mkdtempSync(join(tmpdir(), "code-nest-beliefs-"));
  paths.push(path);
  const ledger = EventLedger.open(join(path, "events.sqlite"));
  ledgers.push(ledger);
  return ledger;
}

function eventDraft(input: {
  eventId: string;
  commandId: string;
  kind: string;
  payload?: JsonValue;
  visibility?: EventDraft["visibility"];
}): EventDraft {
  return {
    schemaVersion: EVENT_SCHEMA_VERSION,
    eventId: input.eventId,
    runId: "run-beliefs",
    recordedAt: "2026-09-17T20:00:00.000Z",
    actor: { kind: "controller", id: "fixture" },
    context: { round: 1, phase: "evidence" },
    kind: input.kind,
    payload: input.payload ?? {},
    visibility: input.visibility ?? { class: "public" },
    causationId: input.commandId,
    correlationId: "run-beliefs",
    parentEventIds: [],
    artifactDigests: [],
    resourceCost: {},
  };
}

function seed(ledger: EventLedger): void {
  ledger.appendCommandEvent("create-run", eventDraft({
    eventId: "event-run-created",
    commandId: "create-run",
    kind: "run.created",
  }));
  ledger.appendCommandEvent("publish-evidence", eventDraft({
    eventId: "event-public-evidence",
    commandId: "publish-evidence",
    kind: "participant.work_captured",
    payload: { participantId: "player-b" },
  }));
  ledger.appendCommandEvent("publish-private-evidence", eventDraft({
    eventId: "event-private-evidence",
    commandId: "publish-private-evidence",
    kind: "investigation.completed",
    payload: { summary: "private" },
    visibility: { class: "participant_private", recipientIds: ["player-b"] },
  }));
}

function request(
  overrides: Partial<SubmitPrivateBeliefRequest> = {},
): SubmitPrivateBeliefRequest {
  return {
    runId: "run-beliefs",
    commandId: "belief-command-a",
    participantId: "player-a",
    round: 1,
    allocations: [
      { participantId: "player-b", points: 60 },
      { participantId: "player-c", points: 25 },
      { participantId: "player-d", points: 15 },
    ],
    strongestEvidenceEventId: "event-public-evidence",
    ...overrides,
  };
}

function setup(context: BeliefSubmissionContext = {
  round: 1,
  phase: "belief",
  activeParticipantIds: roster,
}) {
  const ledger = openLedger();
  seed(ledger);
  const contexts = new MutableContextReader(context);
  let eventNumber = 1;
  const journal = new EventLedgerBeliefJournal(ledger, {
    createEventId: () => `event-belief-${eventNumber++}`,
    now: () => new Date("2026-09-17T20:01:00.000Z"),
  });
  const service = new BeliefService({
    contexts,
    evidence: new EventLedgerBeliefEvidenceReader(ledger),
    journal,
  });
  return { contexts, journal, ledger, service };
}

describe("private belief visibility", () => {
  it("stores a belief only for its reporter and revealed research replay", () => {
    const { ledger, service } = setup();
    const receipt = service.submit(request());
    const event = ledger.getEvent(receipt.eventId);
    if (event === undefined) throw new Error("Expected the accepted belief event.");
    expect(receipt.status).toBe("accepted");
    expect(event?.visibility).toEqual({
      class: "participant_private",
      recipientIds: ["player-a"],
    });
    expect(event?.parentEventIds).toEqual(["event-public-evidence"]);
    expect(projectEventForAudience(event, {
      runId: "run-beliefs",
      revealState: "sealed",
      audience: { kind: "participant", participantId: "player-a" },
    })).toBeDefined();
    expect(projectEventForAudience(event, {
      runId: "run-beliefs",
      revealState: "sealed",
      audience: { kind: "participant", participantId: "player-b" },
    })).toBeUndefined();
    expect(projectEventForAudience(event, {
      runId: "run-beliefs",
      revealState: "sealed",
      audience: { kind: "observer", mode: "clean" },
    })).toBeUndefined();
    expect(projectEventForAudience(event, {
      runId: "run-beliefs",
      revealState: "revealed",
      audience: { kind: "observer", mode: "clean" },
    })).toBeDefined();
  });

  it("rejects evidence the reporter could not see without leaking why", () => {
    const { ledger, service } = setup();
    for (const eventId of ["event-private-evidence", "event-missing"]) {
      expect(() => service.submit(request({
        commandId: `belief-${eventId}`,
        strongestEvidenceEventId: eventId,
      }))).toThrowError(expect.objectContaining({
        code: "BELIEF_EVIDENCE_UNAVAILABLE",
        message: "Cited belief evidence is not available to this participant.",
      }));
    }
    expect(ledger.listEvents("run-beliefs").filter(({ kind }) =>
      kind === "belief.reported"
    )).toHaveLength(0);
  });

  it("accepts only an active reporter during that round's belief phase", () => {
    const wrongPhase = setup({
      round: 1,
      phase: "town_hall",
      activeParticipantIds: roster,
    });
    expect(() => wrongPhase.service.submit(request())).toThrowError(
      expect.objectContaining({ code: "BELIEF_SUBMISSION_UNAUTHORIZED" }),
    );
    wrongPhase.ledger.close();

    const inactive = setup({
      round: 1,
      phase: "belief",
      activeParticipantIds: ["player-b", "player-c", "player-d"],
    });
    expect(() => inactive.service.submit(request())).toThrowError(
      expect.objectContaining({ code: "BELIEF_SUBMISSION_UNAUTHORIZED" }),
    );
  });

  it("replays an exact retry after phase closure and rejects changed reuse", () => {
    const { contexts, journal, ledger, service } = setup();
    const first = service.submit(request());
    contexts.value = { round: 1, phase: "town_hall", activeParticipantIds: roster };
    const recovered = new BeliefService({
      contexts,
      evidence: new EventLedgerBeliefEvidenceReader(ledger),
      journal,
    });

    expect(recovered.submit(request())).toEqual({ ...first, status: "duplicate" });
    expect(() => recovered.submit(request({
      allocations: [
        { participantId: "player-b", points: 55 },
        { participantId: "player-c", points: 30 },
        { participantId: "player-d", points: 15 },
      ],
    }))).toThrowError(expect.objectContaining({ code: "BELIEF_COMMAND_CONFLICT" }));
    expect(ledger.listEvents("run-beliefs").filter(({ kind }) =>
      kind === "belief.reported"
    )).toHaveLength(1);
  });

  it("rejects command IDs already used by another controller action", () => {
    const { ledger, service } = setup();
    expect(() => service.submit(request({ commandId: "create-run" }))).toThrowError(
      BeliefApplicationError,
    );
    expect(() => service.submit(request({ commandId: "create-run" }))).toThrowError(
      expect.objectContaining({ code: "BELIEF_COMMAND_CONFLICT" }),
    );
    ledger.close();
  });
});
