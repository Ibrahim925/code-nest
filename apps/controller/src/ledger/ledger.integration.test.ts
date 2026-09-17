import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { EVENT_SCHEMA_VERSION } from "@code-nest/protocol";
import { afterEach, describe, expect, it } from "vitest";

import {
  EventLedger,
  EventLedgerError,
  type EventDraft,
} from "./ledger";

const temporaryDirectories: string[] = [];
const openLedgers: EventLedger[] = [];

async function createDatabasePath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "code-nest-ledger-"));
  temporaryDirectories.push(directory);
  return join(directory, "events.sqlite");
}

function openLedger(path: string): EventLedger {
  const ledger = EventLedger.open(path);
  openLedgers.push(ledger);
  return ledger;
}

function closeLedger(ledger: EventLedger): void {
  ledger.close();
  const index = openLedgers.indexOf(ledger);
  if (index !== -1) openLedgers.splice(index, 1);
}

function eventDraft(
  runId: string,
  eventId: string,
  commandId: string,
): EventDraft {
  return {
    schemaVersion: EVENT_SCHEMA_VERSION,
    eventId,
    runId,
    recordedAt: "2026-09-17T12:00:00.000Z",
    actor: {
      kind: "controller",
      id: "controller",
    },
    context: {
      round: 0,
      phase: "briefing",
    },
    kind: "command.accepted",
    payload: {
      commandId,
    },
    visibility: {
      class: "public",
    },
    causationId: commandId,
    correlationId: `corr-${commandId}`,
    parentEventIds: [],
    artifactDigests: [],
    resourceCost: {},
  };
}

function expectLedgerError(
  operation: () => unknown,
  code: EventLedgerError["code"],
): void {
  try {
    operation();
    throw new Error("Expected EventLedgerError");
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(EventLedgerError);
    if (!(error instanceof EventLedgerError)) return;
    expect(error.code).toBe(code);
  }
}

afterEach(async () => {
  for (const ledger of openLedgers.splice(0)) ledger.close();
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { force: true, recursive: true });
  }
});

describe("durable event ledger", () => {
  it("assigns gap-free sequences independently for each run", async () => {
    const ledger = openLedger(await createDatabasePath());

    const firstA = ledger.appendCommandEvent(
      "cmd-a-1",
      eventDraft("run-a", "evt-a-1", "cmd-a-1"),
    );
    const secondA = ledger.appendCommandEvent(
      "cmd-a-2",
      eventDraft("run-a", "evt-a-2", "cmd-a-2"),
    );
    const firstB = ledger.appendCommandEvent(
      "cmd-b-1",
      eventDraft("run-b", "evt-b-1", "cmd-b-1"),
    );

    expect(firstA).toMatchObject({ status: "appended", event: { sequence: 1 } });
    expect(secondA).toMatchObject({ status: "appended", event: { sequence: 2 } });
    expect(firstB).toMatchObject({ status: "appended", event: { sequence: 1 } });
    expect(ledger.listEvents("run-a").map((event) => event.sequence)).toEqual([
      1, 2,
    ]);
  });

  it("returns the original event when a command is retried", async () => {
    const ledger = openLedger(await createDatabasePath());
    const draft = eventDraft("run-a", "evt-a-1", "cmd-a-1");

    const first = ledger.appendCommandEvent("cmd-a-1", draft);
    const retry = ledger.appendCommandEvent("cmd-a-1", draft);
    const next = ledger.appendCommandEvent(
      "cmd-a-2",
      eventDraft("run-a", "evt-a-2", "cmd-a-2"),
    );

    expect(retry).toEqual({ status: "duplicate", event: first.event });
    expect(next.event.sequence).toBe(2);
    expect(ledger.listEvents("run-a")).toHaveLength(2);
  });

  it("rolls back a reserved sequence when event insertion fails", async () => {
    const path = await createDatabasePath();
    const ledger = openLedger(path);
    ledger.appendCommandEvent(
      "cmd-a-1",
      eventDraft("run-a", "evt-a-1", "cmd-a-1"),
    );

    const faultInjector = new DatabaseSync(path);
    faultInjector.exec(`
      CREATE TRIGGER reject_test_event
      BEFORE INSERT ON ledger_events
      WHEN NEW.event_id = 'evt-fail'
      BEGIN
        SELECT RAISE(ABORT, 'forced test failure');
      END;
    `);
    faultInjector.close();

    expectLedgerError(
      () =>
        ledger.appendCommandEvent(
          "cmd-a-2",
          eventDraft("run-a", "evt-fail", "cmd-a-2"),
        ),
      "WRITE_FAILED",
    );

    const faultRemover = new DatabaseSync(path);
    faultRemover.exec("DROP TRIGGER reject_test_event");
    faultRemover.close();

    const next = ledger.appendCommandEvent(
      "cmd-a-3",
      eventDraft("run-a", "evt-a-3", "cmd-a-3"),
    );
    expect(next.event.sequence).toBe(2);
  });

  it("survives close and reopen without duplicating a retried command", async () => {
    const path = await createDatabasePath();
    const draft = eventDraft("run-a", "evt-a-1", "cmd-a-1");
    const initial = openLedger(path);
    const first = initial.appendCommandEvent("cmd-a-1", draft);
    closeLedger(initial);

    const reopened = openLedger(path);
    const retry = reopened.appendCommandEvent("cmd-a-1", draft);

    expect(retry).toEqual({ status: "duplicate", event: first.event });
    expect(reopened.getEvent("evt-a-1")).toEqual(first.event);
    expect(reopened.listEvents("run-a")).toEqual([first.event]);
  });

  it("returns ordered catch-up events strictly after a sequence", async () => {
    const ledger = openLedger(await createDatabasePath());
    for (let index = 1; index <= 3; index += 1) {
      ledger.appendCommandEvent(
        `cmd-a-${index}`,
        eventDraft("run-a", `evt-a-${index}`, `cmd-a-${index}`),
      );
    }

    expect(
      ledger.listEvents("run-a", { afterSequence: 1, limit: 10 }).map(
        (event) => event.sequence,
      ),
    ).toEqual([2, 3]);
  });

  it("publishes new events only after commit and never republishes a retry", async () => {
    const ledger = openLedger(await createDatabasePath());
    const published: Array<{ eventId: string; persisted: boolean }> = [];
    let resolvePublished = (): void => {};
    const firstPublication = new Promise<void>((resolve) => {
      resolvePublished = resolve;
    });
    const unsubscribe = ledger.subscribe("run-a", (event) => {
      published.push({
        eventId: event.eventId,
        persisted: ledger.getEvent(event.eventId) !== undefined,
      });
      resolvePublished();
    });
    const draft = eventDraft("run-a", "evt-a-1", "cmd-a-1");

    ledger.appendCommandEvent("cmd-a-1", draft);
    await firstPublication;
    ledger.appendCommandEvent("cmd-a-1", draft);
    await Promise.resolve();

    expect(published).toEqual([{ eventId: "evt-a-1", persisted: true }]);
    unsubscribe();
  });

  it("opens file-backed databases in WAL mode", async () => {
    const path = await createDatabasePath();
    const ledger = openLedger(path);
    closeLedger(ledger);

    const database = new DatabaseSync(path, { readOnly: true });
    const row = database.prepare("PRAGMA journal_mode").get();
    database.close();

    expect(row).toMatchObject({ journal_mode: "wal" });
  });

  it("rejects a stored event that no longer matches the protocol", async () => {
    const path = await createDatabasePath();
    const ledger = openLedger(path);
    ledger.appendCommandEvent(
      "cmd-a-1",
      eventDraft("run-a", "evt-a-1", "cmd-a-1"),
    );
    closeLedger(ledger);

    const database = new DatabaseSync(path);
    database
      .prepare("UPDATE ledger_events SET envelope_json = ? WHERE event_id = ?")
      .run('{"schemaVersion":"1.0"}', "evt-a-1");
    database.close();

    const reopened = openLedger(path);
    expectLedgerError(() => reopened.getEvent("evt-a-1"), "CORRUPT_STORED_EVENT");
  });
});
