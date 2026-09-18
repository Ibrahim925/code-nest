import { timingSafeEqual } from "node:crypto";

import {
  parseRunSetupConfiguration,
  type RunSetupConfiguration,
} from "@code-nest/protocol";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import {
  RunApplicationError,
} from "../application/run-lifecycle.js";
import type { RunLifecycleUseCases } from "../application/ports/run-lifecycle.js";
import { RunStoreError } from "../application/ports/run-lifecycle-store.js";
import { RunHistoryError, type RunAction } from "../domain/lifecycle.js";

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

interface ErrorResponse {
  readonly error: {
    readonly code: string;
    readonly message: string;
  };
}

function errorResponse(code: string, message: string): ErrorResponse {
  return { error: { code, message } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIdentifier(value: unknown): value is string {
  return typeof value === "string" && IDENTIFIER_PATTERN.test(value);
}

interface CreationRequest {
  readonly runId: string;
  readonly configuration?: RunSetupConfiguration;
}

function parseCreationBody(body: unknown): CreationRequest | undefined {
  if (!isRecord(body) || !isIdentifier(body.runId)) return undefined;
  const keys = Object.keys(body).sort();
  if (keys.length === 1 && keys[0] === "runId") return { runId: body.runId };
  if (
    keys.length !== 2 ||
    keys[0] !== "configuration" ||
    keys[1] !== "runId"
  ) {
    return undefined;
  }
  const parsed = parseRunSetupConfiguration(body.configuration);
  if (!parsed.ok || parsed.value.runId !== body.runId) return undefined;
  return { runId: body.runId, configuration: parsed.value };
}

function isEmptyMutationBody(body: unknown): boolean {
  return body === undefined || (isRecord(body) && Object.keys(body).length === 0);
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

function requireOperator(
  request: FastifyRequest,
  reply: FastifyReply,
  expectedToken: string,
): boolean {
  if (tokensMatch(bearerToken(request), expectedToken)) return true;
  void reply
    .code(401)
    .send(
      errorResponse(
        "UNAUTHORIZED",
        "Valid operator authorization is required.",
      ),
    );
  return false;
}

function idempotencyKey(request: FastifyRequest): string | undefined {
  const value = request.headers["idempotency-key"];
  return isIdentifier(value) ? value : undefined;
}

function sendApplicationError(
  reply: FastifyReply,
  error: unknown,
): FastifyReply {
  if (error instanceof RunApplicationError) {
    return reply
      .code(error.code === "RUN_NOT_FOUND" ? 404 : 409)
      .send(errorResponse(error.code, error.message));
  }
  if (error instanceof RunHistoryError) {
    return reply
      .code(500)
      .send(
        errorResponse("CORRUPT_RUN_HISTORY", "Stored run history is invalid."),
      );
  }
  if (error instanceof RunStoreError) {
    return reply
      .code(500)
      .send(
        errorResponse(
          "RUN_PERSISTENCE_FAILED",
          "Run state could not be persisted.",
        ),
      );
  }
  throw error;
}

function requireCommandId(
  request: FastifyRequest,
  reply: FastifyReply,
): string | undefined {
  const commandId = idempotencyKey(request);
  if (commandId !== undefined) return commandId;
  void reply
    .code(400)
    .send(
      errorResponse(
        "INVALID_IDEMPOTENCY_KEY",
        "A valid idempotency-key header is required.",
      ),
    );
  return undefined;
}

export function registerRunRoutes(
  app: FastifyInstance,
  service: RunLifecycleUseCases,
  operatorToken: string,
): void {
  if (operatorToken.length === 0) {
    throw new Error("Run routes require a non-empty operator token.");
  }

  app.post("/runs", (request, reply) => {
    if (!requireOperator(request, reply, operatorToken)) return;
    const commandId = requireCommandId(request, reply);
    if (commandId === undefined) return;
    const creation = parseCreationBody(request.body);
    if (creation === undefined) {
      return reply
        .code(400)
        .send(
          errorResponse(
            "INVALID_RUN_REQUEST",
            "Creation requires a valid runId and optional matching run configuration.",
          ),
        );
    }

    try {
      return reply
        .code(201)
        .send(service.create(creation.runId, commandId, creation.configuration));
    } catch (error: unknown) {
      return sendApplicationError(reply, error);
    }
  });

  app.get<{ Params: { runId: string } }>("/runs/:runId", (request, reply) => {
    if (!requireOperator(request, reply, operatorToken)) return;
    if (!isIdentifier(request.params.runId)) {
      return reply
        .code(400)
        .send(errorResponse("INVALID_RUN_ID", "Run ID is invalid."));
    }
    try {
      return reply.send(service.get(request.params.runId));
    } catch (error: unknown) {
      return sendApplicationError(reply, error);
    }
  });

  const registerMutation = (
    action: Exclude<RunAction, "create">,
  ): void => {
    app.post<{ Params: { runId: string } }>(
      `/runs/:runId/${action}`,
      (request, reply) => {
        if (!requireOperator(request, reply, operatorToken)) return;
        if (!isIdentifier(request.params.runId)) {
          return reply
            .code(400)
            .send(errorResponse("INVALID_RUN_ID", "Run ID is invalid."));
        }
        const commandId = requireCommandId(request, reply);
        if (commandId === undefined) return;
        if (!isEmptyMutationBody(request.body)) {
          return reply
            .code(400)
            .send(
              errorResponse(
                "INVALID_RUN_REQUEST",
                "Lifecycle mutations do not accept a request body.",
              ),
            );
        }

        try {
          return reply.send(
            service[action](request.params.runId, commandId),
          );
        } catch (error: unknown) {
          return sendApplicationError(reply, error);
        }
      },
    );
  };

  registerMutation("pause");
  registerMutation("resume");
  registerMutation("cancel");
}
