import { DatabaseSync, type StatementSync } from "node:sqlite";

import {
  parseEventEnvelope,
  type EventEnvelope,
} from "@code-nest/protocol";

const DATABASE_SCHEMA_VERSION = 1;

const CREATE_SCHEMA_SQL = `
  CREATE TABLE ledger_runs (
    run_id TEXT PRIMARY KEY,
    next_sequence INTEGER NOT NULL DEFAULT 1 CHECK (next_sequence >= 1)
  ) STRICT;

  CREATE TABLE ledger_events (
    run_id TEXT NOT NULL,
    sequence INTEGER NOT NULL CHECK (sequence >= 1),
    event_id TEXT NOT NULL UNIQUE,
    envelope_json TEXT NOT NULL CHECK (json_valid(envelope_json)),
    PRIMARY KEY (run_id, sequence),
    FOREIGN KEY (run_id) REFERENCES ledger_runs(run_id) ON DELETE RESTRICT
  ) STRICT;

  CREATE TABLE processed_commands (
    run_id TEXT NOT NULL,
    command_id TEXT NOT NULL,
    result_event_id TEXT NOT NULL UNIQUE,
    PRIMARY KEY (run_id, command_id),
    FOREIGN KEY (run_id) REFERENCES ledger_runs(run_id) ON DELETE RESTRICT,
    FOREIGN KEY (result_event_id) REFERENCES ledger_events(event_id)
      ON DELETE RESTRICT
  ) STRICT;
`;

export type EventDraft = Omit<EventEnvelope, "sequence">;

export type EventLedgerErrorCode =
  | "CAUSATION_MISMATCH"
  | "CORRUPT_STORED_EVENT"
  | "EVENT_ID_CONFLICT"
  | "INVALID_EVENT"
  | "INVALID_QUERY"
  | "UNSUPPORTED_DATABASE_SCHEMA"
  | "WAL_UNAVAILABLE"
  | "WRITE_FAILED";

export class EventLedgerError extends Error {
  constructor(
    readonly code: EventLedgerErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "EventLedgerError";
  }
}

export interface AppendEventResult {
  status: "appended" | "duplicate";
  event: EventEnvelope;
}

export interface ListEventsOptions {
  afterSequence?: number;
  limit?: number;
}

interface StoredEventRow {
  runId: string;
  sequence: number;
  eventId: string;
  envelopeJson: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readInteger(row: unknown, key: string): number | undefined {
  if (!isRecord(row)) return undefined;
  const value = row[key];
  return typeof value === "number" && Number.isSafeInteger(value)
    ? value
    : undefined;
}

function readText(row: unknown, key: string): string | undefined {
  if (!isRecord(row)) return undefined;
  const value = row[key];
  return typeof value === "string" ? value : undefined;
}

function storedEventRow(row: unknown): StoredEventRow {
  const runId = readText(row, "run_id");
  const sequence = readInteger(row, "sequence");
  const eventId = readText(row, "event_id");
  const envelopeJson = readText(row, "envelope_json");

  if (
    runId === undefined ||
    sequence === undefined ||
    eventId === undefined ||
    envelopeJson === undefined
  ) {
    throw new EventLedgerError(
      "CORRUPT_STORED_EVENT",
      "Stored event metadata is invalid.",
    );
  }

  return { runId, sequence, eventId, envelopeJson };
}

function decodeStoredEvent(row: unknown): EventEnvelope {
  const stored = storedEventRow(row);
  let value: unknown;

  try {
    value = JSON.parse(stored.envelopeJson) as unknown;
  } catch (error: unknown) {
    throw new EventLedgerError(
      "CORRUPT_STORED_EVENT",
      `Stored event ${stored.eventId} is not valid JSON.`,
      error,
    );
  }

  const parsed = parseEventEnvelope(value);
  if (
    !parsed.ok ||
    parsed.value.runId !== stored.runId ||
    parsed.value.sequence !== stored.sequence ||
    parsed.value.eventId !== stored.eventId
  ) {
    throw new EventLedgerError(
      "CORRUPT_STORED_EVENT",
      `Stored event ${stored.eventId} does not match its ledger metadata.`,
    );
  }

  return parsed.value;
}

function configureDatabase(database: DatabaseSync): void {
  database.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA synchronous = FULL;
    PRAGMA trusted_schema = OFF;
    PRAGMA busy_timeout = 5000;
  `);

  const journalMode = readText(
    database.prepare("PRAGMA journal_mode = WAL").get(),
    "journal_mode",
  );
  if (journalMode !== "wal") {
    throw new EventLedgerError(
      "WAL_UNAVAILABLE",
      "Event ledger requires SQLite WAL mode on a local filesystem.",
    );
  }
}

function migrateDatabase(database: DatabaseSync): void {
  const currentVersion = readInteger(
    database.prepare("PRAGMA user_version").get(),
    "user_version",
  );

  if (currentVersion === DATABASE_SCHEMA_VERSION) return;
  if (currentVersion !== 0) {
    throw new EventLedgerError(
      "UNSUPPORTED_DATABASE_SCHEMA",
      `Unsupported event-ledger schema version ${String(currentVersion)}.`,
    );
  }

  database.exec("BEGIN IMMEDIATE");
  try {
    database.exec(CREATE_SCHEMA_SQL);
    database.exec(`PRAGMA user_version = ${DATABASE_SCHEMA_VERSION}`);
    database.exec("COMMIT");
  } catch (error: unknown) {
    database.exec("ROLLBACK");
    throw error;
  }
}

function provisionalEvent(draft: EventDraft): EventEnvelope {
  const parsed = parseEventEnvelope({ ...draft, sequence: 1 });
  if (!parsed.ok) {
    throw new EventLedgerError(
      "INVALID_EVENT",
      "Event draft failed protocol validation.",
      parsed.error,
    );
  }
  return parsed.value;
}

export class EventLedger {
  readonly #database: DatabaseSync;
  readonly #findCommand: StatementSync;
  readonly #findEvent: StatementSync;
  readonly #insertRun: StatementSync;
  readonly #reserveSequence: StatementSync;
  readonly #insertEvent: StatementSync;
  readonly #insertCommand: StatementSync;
  readonly #getCommandResult: StatementSync;
  readonly #getEvent: StatementSync;
  readonly #listEvents: StatementSync;
  #closed = false;

  private constructor(database: DatabaseSync) {
    this.#database = database;
    this.#findCommand = database.prepare(`
      SELECT e.run_id, e.sequence, e.event_id, e.envelope_json
      FROM processed_commands AS c
      JOIN ledger_events AS e ON e.event_id = c.result_event_id
      WHERE c.run_id = ? AND c.command_id = ?
    `);
    this.#findEvent = database.prepare(`
      SELECT run_id, sequence, event_id, envelope_json
      FROM ledger_events
      WHERE event_id = ?
    `);
    this.#insertRun = database.prepare(`
      INSERT INTO ledger_runs (run_id, next_sequence)
      VALUES (?, 1)
      ON CONFLICT (run_id) DO NOTHING
    `);
    this.#reserveSequence = database.prepare(`
      UPDATE ledger_runs
      SET next_sequence = next_sequence + 1
      WHERE run_id = ?
      RETURNING next_sequence - 1 AS sequence
    `);
    this.#insertEvent = database.prepare(`
      INSERT INTO ledger_events (run_id, sequence, event_id, envelope_json)
      VALUES (?, ?, ?, ?)
    `);
    this.#insertCommand = database.prepare(`
      INSERT INTO processed_commands (run_id, command_id, result_event_id)
      VALUES (?, ?, ?)
    `);
    this.#getCommandResult = database.prepare(`
      SELECT e.run_id, e.sequence, e.event_id, e.envelope_json
      FROM processed_commands AS c
      JOIN ledger_events AS e ON e.event_id = c.result_event_id
      WHERE c.run_id = ? AND c.command_id = ?
    `);
    this.#getEvent = database.prepare(`
      SELECT run_id, sequence, event_id, envelope_json
      FROM ledger_events
      WHERE event_id = ?
    `);
    this.#listEvents = database.prepare(`
      SELECT run_id, sequence, event_id, envelope_json
      FROM ledger_events
      WHERE run_id = ? AND sequence > ?
      ORDER BY sequence ASC
      LIMIT ?
    `);
  }

  static open(path: string): EventLedger {
    const database = new DatabaseSync(path, {
      allowExtension: false,
      enableDoubleQuotedStringLiterals: false,
      enableForeignKeyConstraints: true,
    });

    try {
      configureDatabase(database);
      migrateDatabase(database);
      return new EventLedger(database);
    } catch (error: unknown) {
      database.close();
      throw error;
    }
  }

  appendCommandEvent(commandId: string, draft: EventDraft): AppendEventResult {
    const provisional = provisionalEvent(draft);
    if (provisional.causationId !== commandId) {
      throw new EventLedgerError(
        "CAUSATION_MISMATCH",
        "Command ID must match the event causation ID.",
      );
    }

    this.#database.exec("BEGIN IMMEDIATE");
    let transactionOpen = true;
    try {
      const previous = this.#findCommand.get(provisional.runId, commandId);
      if (previous !== undefined) {
        const event = decodeStoredEvent(previous);
        this.#database.exec("COMMIT");
        transactionOpen = false;
        return { status: "duplicate", event };
      }

      this.#insertRun.run(provisional.runId);
      if (this.#findEvent.get(provisional.eventId) !== undefined) {
        throw new EventLedgerError(
          "EVENT_ID_CONFLICT",
          `Event ID ${provisional.eventId} already exists.`,
        );
      }

      const sequence = readInteger(
        this.#reserveSequence.get(provisional.runId),
        "sequence",
      );
      if (sequence === undefined || sequence < 1) {
        throw new EventLedgerError(
          "WRITE_FAILED",
          "Failed to reserve the next event sequence.",
        );
      }

      const event: EventEnvelope = { ...provisional, sequence };
      this.#insertEvent.run(
        event.runId,
        event.sequence,
        event.eventId,
        JSON.stringify(event),
      );
      this.#insertCommand.run(event.runId, commandId, event.eventId);
      this.#database.exec("COMMIT");
      transactionOpen = false;
      return { status: "appended", event };
    } catch (error: unknown) {
      if (transactionOpen) this.#database.exec("ROLLBACK");
      if (error instanceof EventLedgerError) throw error;
      throw new EventLedgerError(
        "WRITE_FAILED",
        "Failed to append the event transaction.",
        error,
      );
    }
  }

  getEvent(eventId: string): EventEnvelope | undefined {
    const row = this.#getEvent.get(eventId);
    return row === undefined ? undefined : decodeStoredEvent(row);
  }

  getCommandResult(
    runId: string,
    commandId: string,
  ): EventEnvelope | undefined {
    const row = this.#getCommandResult.get(runId, commandId);
    return row === undefined ? undefined : decodeStoredEvent(row);
  }

  listEvents(
    runId: string,
    options: ListEventsOptions = {},
  ): EventEnvelope[] {
    const afterSequence = options.afterSequence ?? 0;
    const limit = options.limit ?? 1_000;
    if (
      !Number.isSafeInteger(afterSequence) ||
      afterSequence < 0 ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 1_000
    ) {
      throw new EventLedgerError(
        "INVALID_QUERY",
        "Event query requires afterSequence >= 0 and limit between 1 and 1000.",
      );
    }

    return this.#listEvents
      .all(runId, afterSequence, limit)
      .map((row) => decodeStoredEvent(row));
  }

  close(): void {
    if (this.#closed) return;
    this.#database.close();
    this.#closed = true;
  }
}
