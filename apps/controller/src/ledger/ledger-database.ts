import { type DatabaseSync } from "node:sqlite";

import {
  parseEventEnvelope,
  type EventEnvelope,
} from "@code-nest/protocol";

import { EventLedgerError } from "./ledger-contract.js";

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

interface StoredEventRow {
  runId: string;
  sequence: number;
  eventId: string;
  envelopeJson: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readInteger(row: unknown, key: string): number | undefined {
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

export function decodeStoredEvent(row: unknown): EventEnvelope {
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

export function configureAndMigrateDatabase(database: DatabaseSync): void {
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
