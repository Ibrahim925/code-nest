import { timingSafeEqual } from "node:crypto";

import type { EventAudience, EventProjectionContext } from "@code-nest/core";
import type { EventDelivery } from "@code-nest/protocol";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { EventStreamError } from "../application/event-stream.js";
import type {
  EventStreamCursor,
  EventStreamSink,
  EventStreamUseCases,
} from "../application/ports/event-stream.js";
import { EventStreamSourceError } from "../application/ports/event-stream-source.js";

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const HEARTBEAT_MILLISECONDS = 15_000;

interface ErrorResponse {
  readonly error: {
    readonly code: string;
    readonly message: string;
  };
}

export interface SseRouteOptions {
  readonly operatorToken: string;
  readonly observerToken: string;
}

function errorResponse(code: string, message: string): ErrorResponse {
  return { error: { code, message } };
}

function isIdentifier(value: unknown): value is string {
  return typeof value === "string" && IDENTIFIER_PATTERN.test(value);
}

function bearerToken(request: FastifyRequest): string | undefined {
  const authorization = request.headers.authorization;
  if (
    typeof authorization !== "string" ||
    !authorization.startsWith("Bearer ")
  ) {
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

function authenticateAudience(
  request: FastifyRequest,
  options: SseRouteOptions,
): EventAudience | undefined {
  const token = bearerToken(request);
  if (tokensMatch(token, options.operatorToken)) return { kind: "operator" };
  if (tokensMatch(token, options.observerToken)) {
    return { kind: "observer", mode: "clean" };
  }
  return undefined;
}

function sendStreamError(reply: FastifyReply, error: unknown): FastifyReply {
  if (error instanceof EventStreamError) {
    return reply
      .code(error.code === "RUN_NOT_FOUND" ? 404 : 400)
      .send(errorResponse(error.code, error.message));
  }
  if (error instanceof EventStreamSourceError) {
    return reply
      .code(500)
      .send(
        errorResponse(
          "EVENT_STREAM_UNAVAILABLE",
          "Event stream storage is unavailable.",
        ),
      );
  }
  throw error;
}

function encodeEvent(delivery: EventDelivery): string {
  return [
    `id: ${delivery.event.eventId}`,
    "event: code-nest-event",
    `data: ${JSON.stringify(delivery)}`,
    "",
    "",
  ].join("\n");
}

export function registerSseRoutes(
  app: FastifyInstance,
  service: EventStreamUseCases,
  options: SseRouteOptions,
): void {
  if (
    options.operatorToken.length === 0 ||
    options.observerToken.length === 0 ||
    options.operatorToken === options.observerToken
  ) {
    throw new Error("SSE routes require distinct non-empty audience tokens.");
  }

  const activeConnections = new Set<() => void>();
  app.addHook("preClose", async () => {
    for (const close of [...activeConnections]) close();
  });

  app.get<{ Params: { runId: string } }>(
    "/runs/:runId/events",
    (request, reply) => {
      const audience = authenticateAudience(request, options);
      if (audience === undefined) {
        return reply
          .code(401)
          .send(
            errorResponse(
              "UNAUTHORIZED",
              "Valid stream authorization is required.",
            ),
          );
      }
      const runId = request.params.runId;
      if (!isIdentifier(runId)) {
        return reply
          .code(400)
          .send(errorResponse("INVALID_RUN_ID", "Run ID is invalid."));
      }
      const lastEventId = request.headers["last-event-id"];
      if (lastEventId !== undefined && !isIdentifier(lastEventId)) {
        return reply
          .code(400)
          .send(
            errorResponse(
              "INVALID_EVENT_CURSOR",
              "Event cursor is unavailable for this stream.",
            ),
          );
      }

      const context: EventProjectionContext = {
        runId,
        revealState: "sealed",
        audience,
      };
      let cursor: EventStreamCursor;
      try {
        cursor = service.resolveCursor(context, lastEventId);
      } catch (error: unknown) {
        return sendStreamError(reply, error);
      }

      reply.hijack();
      reply.raw.setHeader("content-type", "text/event-stream; charset=utf-8");
      reply.raw.setHeader("cache-control", "no-cache, no-transform");
      reply.raw.setHeader("connection", "keep-alive");
      reply.raw.setHeader("x-accel-buffering", "no");
      reply.raw.flushHeaders();

      let closed = false;
      let closeSubscription = (): void => {};
      const connectionState: { heartbeat?: NodeJS.Timeout } = {};
      const close = (endResponse: boolean): void => {
        if (closed) return;
        closed = true;
        if (connectionState.heartbeat !== undefined) {
          clearInterval(connectionState.heartbeat);
        }
        closeSubscription();
        activeConnections.delete(closeForShutdown);
        if (endResponse && !reply.raw.writableEnded) reply.raw.end();
      };
      const closeForShutdown = (): void => close(true);
      const sink: EventStreamSink = {
        send(event) {
          if (!reply.raw.write(encodeEvent(event))) {
            throw new Error("SSE client exceeded the response buffer.");
          }
        },
        close: closeForShutdown,
      };

      activeConnections.add(closeForShutdown);
      reply.raw.once("close", () => close(false));
      if (!reply.raw.write(": connected\n\n")) {
        close(true);
        return;
      }

      try {
        closeSubscription = service.open(context, cursor, sink);
      } catch (error: unknown) {
        request.log.error({ err: error }, "Failed to open event stream.");
        close(true);
        return;
      }

      connectionState.heartbeat = setInterval(() => {
        if (!reply.raw.write(": keep-alive\n\n")) close(true);
      }, HEARTBEAT_MILLISECONDS);
      connectionState.heartbeat.unref();
    },
  );
}
