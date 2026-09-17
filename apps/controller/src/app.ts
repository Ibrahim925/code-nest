import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";

import Fastify, { type FastifyInstance } from "fastify";

import { registerRunRoutes, type RunRouteOptions } from "./runs/routes.js";

export interface BuildAppOptions extends Partial<RunRouteOptions> {
  readonly logger?: boolean;
}

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? true });

  const databasePath = options.databasePath ?? ".code-nest/events.sqlite";
  if (options.databasePath === undefined) mkdirSync(".code-nest", { recursive: true });
  const configuredOperatorToken =
    options.operatorToken ?? process.env.CODE_NEST_OPERATOR_TOKEN;
  const operatorToken = configuredOperatorToken ?? randomUUID();
  if (configuredOperatorToken === undefined) {
    app.log.warn(
      { operatorToken },
      "Generated an ephemeral local operator token for this controller process.",
    );
  }
  registerRunRoutes(app, {
    databasePath,
    operatorToken,
    createEventId: options.createEventId ?? randomUUID,
    ...(options.now === undefined ? {} : { now: options.now }),
  });

  app.get("/health", async () => ({
    service: "code-nest-controller",
    status: "ok",
  }));

  return app;
}
