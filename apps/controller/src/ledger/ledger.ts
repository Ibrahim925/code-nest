import { DatabaseSync, type StatementSync } from "node:sqlite";

import {
  parseEventEnvelope,
  type EventEnvelope,
} from "@code-nest/protocol";

import {
  EventLedgerError,
  type AppendEventResult,
  type EventDraft,
  type EventListener,
  type ListEventsOptions,
} from "./ledger-contract.js";
import {
  configureAndMigrateDatabase,
  decodeStoredEvent,
  readInteger,
} from "./ledger-database.js";

export {
  EventLedgerError,
  type AppendEventResult,
  type EventDraft,
  type EventLedgerErrorCode,
  type EventListener,
  type ListEventsOptions,
} from "./ledger-contract.js";

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
  readonly #listeners = new Map<string, Set<EventListener>>();
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
      configureAndMigrateDatabase(database);
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
      this.#publish(event);
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

  getCommandResult(runId: string, commandId: string): EventEnvelope | undefined {
    const row = this.#getCommandResult.get(runId, commandId);
    return row === undefined ? undefined : decodeStoredEvent(row);
  }

  listEvents(runId: string, options: ListEventsOptions = {}): EventEnvelope[] {
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

  subscribe(runId: string, listener: EventListener): () => void {
    let listeners = this.#listeners.get(runId);
    if (listeners === undefined) {
      listeners = new Set<EventListener>();
      this.#listeners.set(runId, listeners);
    }
    listeners.add(listener);
    return () => {
      const current = this.#listeners.get(runId);
      current?.delete(listener);
      if (current?.size === 0) this.#listeners.delete(runId);
    };
  }

  #publish(event: EventEnvelope): void {
    if (!this.#listeners.has(event.runId)) return;
    queueMicrotask(() => {
      const listeners = this.#listeners.get(event.runId);
      if (listeners === undefined) return;
      for (const listener of [...listeners]) {
        try {
          listener(event);
        } catch {
          // A committed event cannot be rolled back by a failed live consumer.
        }
      }
    });
  }

  close(): void {
    if (this.#closed) return;
    this.#listeners.clear();
    this.#database.close();
    this.#closed = true;
  }
}
