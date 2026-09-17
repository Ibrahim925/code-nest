import { timingSafeEqual } from "node:crypto";

import { EVENT_SCHEMA_VERSION, type EventEnvelope } from "@code-nest/protocol";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import {
  EventLedger,
  EventLedgerError,
  type EventDraft,
} from "../ledger/ledger.js";

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const RUN_EVENT_KINDS = {
  create: "run.created",
  pause: "run.paused",
  resume: "run.resumed",
  cancel: "run.cancelled",
} as const;

type RunAction = keyof typeof RUN_EVENT_KINDS;
type RunStatus = "running" | "paused" | "cancelled";

export interface RunView {
  readonly schemaVersion: "1.0";
  readonly runId: string;
  readonly status: RunStatus;
  readonly terminalReason: "operator_cancelled" | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly lastEventSequence: number;
}

interface RunState extends RunView {
  readonly lastEventId: string;
}

export interface RunRouteOptions {
  readonly databasePath: string;
  readonly operatorToken: string;
  readonly now?: () => Date;
  readonly createEventId: () => string;
}

interface ErrorResponse {
  readonly error: {
    readonly code: string;
    readonly message: string;
  };
}

class RunHistoryError extends Error {}

function errorResponse(code: string, message: string): ErrorResponse {
  return { error: { code, message } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIdentifier(value: unknown): value is string {
  return typeof value === "string" && IDENTIFIER_PATTERN.test(value);
}

function parseCreationBody(body: unknown): string | undefined {
  if (!isRecord(body) || Object.keys(body).length !== 1) return undefined;
  return isIdentifier(body.runId) ? body.runId : undefined;
}

function isEmptyMutationBody(body: unknown): boolean {
  return body === undefined || (isRecord(body) && Object.keys(body).length === 0);
}

function bearerToken(request: FastifyRequest): string | undefined {
  const authorization = request.headers.authorization;
  if (typeof authorization !== "string" || !authorization.startsWith("Bearer ")) {
    return undefined;
  }
  const token = authorization.slice("Bearer ".length);
  return token.length > 0 ? token : undefined;
}

function tokensMatch(actual: string | undefined, expected: string): boolean {
  if (actual === undefined) return false;
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return (
    actualBytes.length === expectedBytes.length &&
    timingSafeEqual(actualBytes, expectedBytes)
  );
}

function requireOperator(
  request: FastifyRequest,
  reply: FastifyReply,
  expectedToken: string,
): boolean {
  if (tokensMatch(bearerToken(request), expectedToken)) return true;
  void reply
    .code(401)
    .send(errorResponse("UNAUTHORIZED", "Valid operator authorization is required."));
  return false;
}

function idempotencyKey(request: FastifyRequest): string | undefined {
  const value = request.headers["idempotency-key"];
  return isIdentifier(value) ? value : undefined;
}

function lifecycleAction(event: EventEnvelope): RunAction | undefined {
  const entry = Object.entries(RUN_EVENT_KINDS).find(
    ([, kind]) => kind === event.kind,
  );
  if (entry === undefined) return undefined;

  const action = entry[0] as RunAction;
  if (!isRecord(event.payload)) {
    throw new RunHistoryError(`Lifecycle event ${event.eventId} has no object payload.`);
  }
  const expectedKeys = action === "cancel" ? ["action", "terminalReason"] : ["action"];
  const keys = Object.keys(event.payload).sort();
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key, index) => key !== [...expectedKeys].sort()[index]) ||
    event.payload.action !== action ||
    (action === "cancel" &&
      event.payload.terminalReason !== "operator_cancelled")
  ) {
    throw new RunHistoryError(`Lifecycle event ${event.eventId} has an invalid payload.`);
  }
  return action;
}

function publicView(state: RunState): RunView {
  return {
    schemaVersion: state.schemaVersion,
    runId: state.runId,
    status: state.status,
    terminalReason: state.terminalReason,
    createdAt: state.createdAt,
    updatedAt: state.updatedAt,
    lastEventSequence: state.lastEventSequence,
  };
}

function applyLifecycleEvent(
  state: RunState | undefined,
  event: EventEnvelope,
): RunState | undefined {
  const action = lifecycleAction(event);
  if (action === undefined) return state;

  if (action === "create") {
    if (state !== undefined) {
      throw new RunHistoryError(`Run ${event.runId} has more than one creation event.`);
    }
    if (event.sequence !== 1) {
      throw new RunHistoryError(`Run ${event.runId} was not created by its first event.`);
    }
    return {
      schemaVersion: "1.0",
      runId: event.runId,
      status: "running",
      terminalReason: null,
      createdAt: event.recordedAt,
      updatedAt: event.recordedAt,
      lastEventSequence: event.sequence,
      lastEventId: event.eventId,
    };
  }

  if (state === undefined) {
    throw new RunHistoryError(`Run ${event.runId} changed state before creation.`);
  }

  const valid =
    (action === "pause" && state.status === "running") ||
    (action === "resume" && state.status === "paused") ||
    (action === "cancel" &&
      (state.status === "running" || state.status === "paused"));
  if (!valid) {
    throw new RunHistoryError(`Run ${event.runId} has an invalid ${action} transition.`);
  }

  return {
    ...state,
    status:
      action === "pause" ? "paused" : action === "resume" ? "running" : "cancelled",
    terminalReason: action === "cancel" ? "operator_cancelled" : null,
    updatedAt: event.recordedAt,
    lastEventSequence: event.sequence,
    lastEventId: event.eventId,
  };
}

function readRun(
  ledger: EventLedger,
  runId: string,
  throughSequence = Number.MAX_SAFE_INTEGER,
): RunState | undefined {
  let state: RunState | undefined;
  let afterSequence = 0;

  while (afterSequence < throughSequence) {
    const events = ledger.listEvents(runId, { afterSequence, limit: 1_000 });
    if (events.length === 0) break;
    for (const event of events) {
      if (event.sequence > throughSequence) return state;
      state = applyLifecycleEvent(state, event);
      afterSequence = event.sequence;
    }
    if (events.length < 1_000) break;
  }
  return state;
}

function eventDraft(
  options: RunRouteOptions,
  runId: string,
  commandId: string,
  action: RunAction,
  parentEventId?: string,
): EventDraft {
  return {
    schemaVersion: EVENT_SCHEMA_VERSION,
    eventId: options.createEventId(),
    runId,
    recordedAt: (options.now ?? (() => new Date()))().toISOString(),
    actor: { kind: "operator", id: "local-operator" },
    context: { round: null, phase: null },
    kind: RUN_EVENT_KINDS[action],
    payload:
      action === "cancel"
        ? { action, terminalReason: "operator_cancelled" }
        : { action },
    visibility: { class: "public" },
    causationId: commandId,
    correlationId: commandId,
    parentEventIds: parentEventId === undefined ? [] : [parentEventId],
    artifactDigests: [],
    resourceCost: {},
  };
}

function duplicateResult(
  ledger: EventLedger,
  runId: string,
  commandId: string,
  action: RunAction,
): RunView | "reused" | undefined {
  const prior = ledger.getCommandResult(runId, commandId);
  if (prior === undefined) return undefined;
  if (prior.kind !== RUN_EVENT_KINDS[action]) return "reused";
  const state = readRun(ledger, runId, prior.sequence);
  if (state === undefined) {
    throw new RunHistoryError(`Command ${commandId} has no resulting run state.`);
  }
  return publicView(state);
}

function mutationError(reply: FastifyReply, code: string, message: string) {
  return reply.code(code === "RUN_NOT_FOUND" ? 404 : 409).send(errorResponse(code, message));
}

function handleHistoryFailure(reply: FastifyReply, error: unknown) {
  if (error instanceof RunHistoryError) {
    return reply
      .code(500)
      .send(errorResponse("CORRUPT_RUN_HISTORY", "Stored run history is invalid."));
  }
  if (error instanceof EventLedgerError) {
    return reply
      .code(500)
      .send(errorResponse("RUN_PERSISTENCE_FAILED", "Run state could not be persisted."));
  }
  throw error;
}

export function registerRunRoutes(
  app: FastifyInstance,
  options: RunRouteOptions,
): void {
  if (options.operatorToken.length === 0) {
    throw new Error("Run routes require a non-empty operator token.");
  }
  const ledger = EventLedger.open(options.databasePath);
  app.addHook("onClose", async () => {
    ledger.close();
  });

  app.post("/runs", (request, reply) => {
    if (!requireOperator(request, reply, options.operatorToken)) return;
    const commandId = idempotencyKey(request);
    if (commandId === undefined) {
      return reply
        .code(400)
        .send(errorResponse("INVALID_IDEMPOTENCY_KEY", "A valid idempotency-key header is required."));
    }
    const runId = parseCreationBody(request.body);
    if (runId === undefined) {
      return reply
        .code(400)
        .send(errorResponse("INVALID_RUN_REQUEST", "Creation requires exactly one valid runId."));
    }

    try {
      const duplicate = duplicateResult(ledger, runId, commandId, "create");
      if (duplicate === "reused") {
        return mutationError(reply, "IDEMPOTENCY_KEY_REUSED", "The idempotency key was used for another action.");
      }
      if (duplicate !== undefined) return reply.code(201).send(duplicate);
      if (ledger.listEvents(runId, { limit: 1 }).length > 0) {
        if (readRun(ledger, runId) === undefined) {
          throw new RunHistoryError(`Run ${runId} has events but no creation event.`);
        }
        return mutationError(
          reply,
          "RUN_ALREADY_EXISTS",
          `Run ${runId} already exists.`,
        );
      }

      const result = ledger.appendCommandEvent(
        commandId,
        eventDraft(options, runId, commandId, "create"),
      );
      const state = readRun(ledger, runId, result.event.sequence);
      if (state === undefined) throw new RunHistoryError(`Run ${runId} was not created.`);
      return reply.code(201).send(publicView(state));
    } catch (error: unknown) {
      return handleHistoryFailure(reply, error);
    }
  });

  app.get<{ Params: { runId: string } }>("/runs/:runId", (request, reply) => {
    if (!requireOperator(request, reply, options.operatorToken)) return;
    if (!isIdentifier(request.params.runId)) {
      return reply
        .code(400)
        .send(errorResponse("INVALID_RUN_ID", "Run ID is invalid."));
    }
    try {
      const state = readRun(ledger, request.params.runId);
      if (state === undefined) {
        return mutationError(reply, "RUN_NOT_FOUND", "Run was not found.");
      }
      return reply.send(publicView(state));
    } catch (error: unknown) {
      return handleHistoryFailure(reply, error);
    }
  });

  const registerMutation = (action: Exclude<RunAction, "create">): void => {
    app.post<{ Params: { runId: string } }>(
      `/runs/:runId/${action}`,
      (request, reply) => {
        if (!requireOperator(request, reply, options.operatorToken)) return;
        const runId = request.params.runId;
        if (!isIdentifier(runId)) {
          return reply
            .code(400)
            .send(errorResponse("INVALID_RUN_ID", "Run ID is invalid."));
        }
        const commandId = idempotencyKey(request);
        if (commandId === undefined) {
          return reply
            .code(400)
            .send(errorResponse("INVALID_IDEMPOTENCY_KEY", "A valid idempotency-key header is required."));
        }
        if (!isEmptyMutationBody(request.body)) {
          return reply
            .code(400)
            .send(errorResponse("INVALID_RUN_REQUEST", "Lifecycle mutations do not accept a request body."));
        }

        try {
          const duplicate = duplicateResult(ledger, runId, commandId, action);
          if (duplicate === "reused") {
            return mutationError(reply, "IDEMPOTENCY_KEY_REUSED", "The idempotency key was used for another action.");
          }
          if (duplicate !== undefined) return reply.send(duplicate);

          const state = readRun(ledger, runId);
          if (state === undefined) {
            return mutationError(reply, "RUN_NOT_FOUND", "Run was not found.");
          }
          const permitted =
            (action === "pause" && state.status === "running") ||
            (action === "resume" && state.status === "paused") ||
            (action === "cancel" &&
              (state.status === "running" || state.status === "paused"));
          if (!permitted) {
            return mutationError(
              reply,
              "RUN_STATE_CONFLICT",
              `Run ${runId} cannot ${action} while ${state.status}.`,
            );
          }

          const result = ledger.appendCommandEvent(
            commandId,
            eventDraft(options, runId, commandId, action, state.lastEventId),
          );
          const updated = readRun(ledger, runId, result.event.sequence);
          if (updated === undefined) {
            throw new RunHistoryError(`Run ${runId} has no state after ${action}.`);
          }
          return reply.send(publicView(updated));
        } catch (error: unknown) {
          return handleHistoryFailure(reply, error);
        }
      },
    );
  };

  registerMutation("pause");
  registerMutation("resume");
  registerMutation("cancel");
}
