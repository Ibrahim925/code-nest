import { timingSafeEqual } from "node:crypto";

import { serializeReplayBundle } from "@code-nest/protocol";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import {
  ObserverModeError,
  type ObserverModeUseCases,
} from "../../observer/application/observer-mode.js";
import type { ReplayExportUseCases } from "../application/export-replay.js";
import { ReplayExportError } from "../application/export-replay.js";

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export interface ReplayRouteOptions {
  readonly operatorToken: string;
  readonly observerToken: string;
  readonly observerModes: ObserverModeUseCases;
}

function errorResponse(code: string, message: string) {
  return { error: { code, message } };
}

function token(request: FastifyRequest): string | undefined {
  const header = request.headers.authorization;
  return typeof header === "string" && header.startsWith("Bearer ")
    ? header.slice("Bearer ".length)
    : undefined;
}

function matches(actual: string | undefined, expected: string): boolean {
  if (actual === undefined || actual.length === 0) return false;
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function authenticated(request: FastifyRequest, options: ReplayRouteOptions): boolean {
  const presented = token(request);
  return matches(presented, options.operatorToken) || matches(presented, options.observerToken);
}

function sendFailure(reply: FastifyReply, error: unknown): FastifyReply {
  if (error instanceof ObserverModeError) {
    return reply.code(error.code === "RUN_NOT_FOUND" ? 404 : 500).send(
      errorResponse(error.code, error.message),
    );
  }
  if (error instanceof ReplayExportError) {
    const status = error.code === "RUN_NOT_FOUND"
      ? 404
      : error.code === "RUN_NOT_TERMINAL" ? 409 : 500;
    return reply.code(status).send(errorResponse(error.code, error.message));
  }
  throw error;
}

export function registerReplayRoutes(
  app: FastifyInstance,
  service: ReplayExportUseCases,
  options: ReplayRouteOptions,
): void {
  app.get<{ Params: { runId: string } }>(
    "/runs/:runId/replay",
    async (request, reply) => {
      if (!authenticated(request, options)) {
        return reply.code(401).send(errorResponse(
          "UNAUTHORIZED",
          "Valid replay authorization is required.",
        ));
      }
      const { runId } = request.params;
      if (!IDENTIFIER.test(runId)) {
        return reply.code(400).send(errorResponse("INVALID_RUN_ID", "Run ID is invalid."));
      }
      try {
        const observerMode = options.observerModes.get(runId);
        const bundle = await service.export({
          context: options.observerModes.projection(runId),
          observerMode,
        });
        return reply
          .header("content-type", "application/vnd.code-nest.replay+json; charset=utf-8")
          .header("content-disposition", `attachment; filename="${runId}.replay.json"`)
          .header("cache-control", "private, no-store")
          .header("x-content-type-options", "nosniff")
          .send(serializeReplayBundle(bundle));
      } catch (error: unknown) {
        return sendFailure(reply, error);
      }
    },
  );
}
