import {
  EVENT_SCHEMA_VERSION,
  parseRunSetupConfiguration,
  type EventEnvelope,
  type RunSetupConfiguration,
} from "@code-nest/protocol";

import {
  RunStoreError,
  type RunEventDraft,
  type RunLifecycleStore,
  type StoredCommandResult,
} from "../application/ports/run-lifecycle-store.js";
import {
  RUN_EVENT_KINDS,
  RunHistoryError,
  type RunAction,
  type RunLifecycleEvent,
} from "../domain/lifecycle.js";
import {
  EventLedger,
  EventLedgerError,
  type EventDraft,
} from "../../ledger/ledger.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function actionForKind(kind: string): RunAction | undefined {
  if (kind === RUN_EVENT_KINDS.create) return "create";
  if (kind === RUN_EVENT_KINDS.pause) return "pause";
  if (kind === RUN_EVENT_KINDS.resume) return "resume";
  if (kind === RUN_EVENT_KINDS.cancel) return "cancel";
  return undefined;
}

function lifecycleEvent(event: EventEnvelope): RunLifecycleEvent | undefined {
  const action = actionForKind(event.kind);
  if (action === undefined) return undefined;
  if (!isRecord(event.payload)) {
    throw new RunHistoryError(
      `Lifecycle event ${event.eventId} has no object payload.`,
    );
  }

  const hasConfiguration =
    action === "create" && "configuration" in event.payload;
  const expectedKeys = action === "cancel"
    ? ["action", "terminalReason"]
    : hasConfiguration
      ? ["action", "configuration"]
      : ["action"];
  const keys = Object.keys(event.payload).sort();
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key, index) => key !== [...expectedKeys].sort()[index]) ||
    event.payload.action !== action ||
    (action === "cancel" &&
      event.payload.terminalReason !== "operator_cancelled")
  ) {
    throw new RunHistoryError(
      `Lifecycle event ${event.eventId} has an invalid payload.`,
    );
  }

  let configuration: RunSetupConfiguration | undefined;
  if (hasConfiguration) {
    const parsed = parseRunSetupConfiguration(event.payload.configuration);
    if (!parsed.ok || parsed.value.runId !== event.runId) {
      throw new RunHistoryError(
        `Lifecycle event ${event.eventId} has an invalid run configuration.`,
      );
    }
    configuration = parsed.value;
  }

  return {
    eventId: event.eventId,
    runId: event.runId,
    sequence: event.sequence,
    recordedAt: event.recordedAt,
    action,
    ...(configuration === undefined ? {} : { configuration }),
  };
}

function eventDraft(draft: RunEventDraft): EventDraft {
  return {
    schemaVersion: EVENT_SCHEMA_VERSION,
    eventId: draft.eventId,
    runId: draft.runId,
    recordedAt: draft.recordedAt,
    actor: { kind: "operator", id: "local-operator" },
    context: { round: null, phase: null },
    kind: RUN_EVENT_KINDS[draft.action],
    payload: draft.action === "cancel"
      ? { action: draft.action, terminalReason: "operator_cancelled" }
      : draft.action === "create" && draft.configuration !== undefined
        ? { action: draft.action, configuration: draft.configuration }
        : { action: draft.action },
    visibility: { class: "public" },
    causationId: draft.commandId,
    correlationId: draft.commandId,
    parentEventIds:
      draft.parentEventId === undefined ? [] : [draft.parentEventId],
    artifactDigests: [],
    resourceCost: {},
  };
}

export class EventLedgerRunStore implements RunLifecycleStore {
  constructor(private readonly ledger: EventLedger) {}

  hasEvents(runId: string): boolean {
    return this.#persist(() =>
      this.ledger.listEvents(runId, { limit: 1 }).length > 0,
    );
  }

  listEvents(
    runId: string,
    throughSequence = Number.MAX_SAFE_INTEGER,
  ): RunLifecycleEvent[] {
    return this.#persist(() => {
      const lifecycleEvents: RunLifecycleEvent[] = [];
      let afterSequence = 0;

      while (afterSequence < throughSequence) {
        const events = this.ledger.listEvents(runId, {
          afterSequence,
          limit: 1_000,
        });
        if (events.length === 0) break;
        for (const event of events) {
          if (event.sequence > throughSequence) return lifecycleEvents;
          const parsed = lifecycleEvent(event);
          if (parsed !== undefined) lifecycleEvents.push(parsed);
          afterSequence = event.sequence;
        }
        if (events.length < 1_000) break;
      }
      return lifecycleEvents;
    });
  }

  getCommandResult(
    runId: string,
    commandId: string,
  ): StoredCommandResult | undefined {
    return this.#persist(() => {
      const event = this.ledger.getCommandResult(runId, commandId);
      if (event === undefined) return undefined;
      const parsed = lifecycleEvent(event);
      return parsed === undefined
        ? { kind: "other" }
        : { kind: "lifecycle", event: parsed };
    });
  }

  append(commandId: string, draft: RunEventDraft): RunLifecycleEvent {
    return this.#persist(() => {
      const result = this.ledger.appendCommandEvent(
        commandId,
        eventDraft(draft),
      );
      const parsed = lifecycleEvent(result.event);
      if (parsed === undefined) {
        throw new RunHistoryError(
          `Command ${commandId} did not produce a lifecycle event.`,
        );
      }
      return parsed;
    });
  }

  #persist<T>(operation: () => T): T {
    try {
      return operation();
    } catch (error: unknown) {
      if (error instanceof EventLedgerError) {
        throw new RunStoreError("Run event storage failed.", error);
      }
      throw error;
    }
  }
}
