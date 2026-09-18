import { timingSafeEqual } from "node:crypto";

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import {
  ObserverModeError,
  type ObserverModeUseCases,
} from "../application/observer-mode.js";

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export interface ObserverModeRouteOptions {
  readonly operatorToken: string;
  readonly observerToken: string;
}

function errorResponse(code: string, message: string) {
  return { error: { code, message } };
}

function bearer(request: FastifyRequest): string | undefined {
  const value = request.headers.authorization;
  if (typeof value !== "string" || !value.startsWith("Bearer ")) return undefined;
  const token = value.slice("Bearer ".length);
  return token.length > 0 ? token : undefined;
}

function matches(actual: string | undefined, expected: string): boolean {
  if (actual === undefined) return false;
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

function authorized(
  request: FastifyRequest,
  options: ObserverModeRouteOptions,
  operatorOnly: boolean,
): boolean {
  const token = bearer(request);
  return matches(token, options.operatorToken) ||
    (!operatorOnly && matches(token, options.observerToken));
}

function emptyBody(value: unknown): boolean {
  return value === undefined ||
    (typeof value === "object" && value !== null && !Array.isArray(value) && Object.keys(value).length === 0);
}

function sendError(reply: FastifyReply, error: unknown): FastifyReply {
  if (error instanceof ObserverModeError) {
    const status = error.code === "RUN_NOT_FOUND" ? 404
      : error.code === "IDEMPOTENCY_KEY_REUSED" ? 409 : 500;
    return reply.code(status).send(errorResponse(error.code, error.message));
  }
  throw error;
}

export function registerObserverModeRoutes(
  app: FastifyInstance,
  service: ObserverModeUseCases,
  options: ObserverModeRouteOptions,
): void {
  if (
    options.operatorToken.length === 0 || options.observerToken.length === 0 ||
    options.operatorToken === options.observerToken
  ) throw new Error("Observer mode routes require distinct non-empty audience tokens.");

  app.get<{ Params: { runId: string } }>("/runs/:runId/observer-mode", (request, reply) => {
    if (!authorized(request, options, false)) {
      return reply.code(401).send(errorResponse("UNAUTHORIZED", "Valid observer authorization is required."));
    }
    if (!IDENTIFIER.test(request.params.runId)) {
      return reply.code(400).send(errorResponse("INVALID_RUN_ID", "Run ID is invalid."));
    }
    try {
      return reply.send(service.get(request.params.runId));
    } catch (error: unknown) {
      return sendError(reply, error);
    }
  });

  app.post<{ Params: { runId: string } }>(
    "/runs/:runId/observer-mode/unblind",
    (request, reply) => {
      if (!authorized(request, options, true)) {
        return reply.code(401).send(errorResponse("UNAUTHORIZED", "Valid operator authorization is required."));
      }
      const commandId = request.headers["idempotency-key"];
      if (!IDENTIFIER.test(request.params.runId) || typeof commandId !== "string" || !IDENTIFIER.test(commandId)) {
        return reply.code(400).send(errorResponse(
          "INVALID_OBSERVER_MODE_REQUEST",
          "Unblinding requires a valid run and idempotency key.",
        ));
      }
      if (!emptyBody(request.body)) {
        return reply.code(400).send(errorResponse(
          "INVALID_OBSERVER_MODE_REQUEST",
          "Unblinding does not accept a request body.",
        ));
      }
      try {
        return reply.send(service.unblind(request.params.runId, commandId));
      } catch (error: unknown) {
        return sendError(reply, error);
      }
    },
  );
}
