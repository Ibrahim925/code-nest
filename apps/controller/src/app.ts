import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";

import Fastify, { type FastifyInstance } from "fastify";

import { EventLedger } from "./ledger/ledger.js";
import { EventLedgerRunStore } from "./runs/adapters/event-ledger-run-store.js";
import { RunLifecycleService } from "./runs/application/run-lifecycle.js";
import { registerRunRoutes } from "./runs/http/routes.js";

export interface BuildAppOptions {
  readonly databasePath?: string;
  readonly operatorToken?: string;
  readonly now?: () => Date;
  readonly createEventId?: () => string;
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
  const ledger = EventLedger.open(databasePath);
  const runStore = new EventLedgerRunStore(ledger);
  const runService = new RunLifecycleService({
    store: runStore,
    createEventId: options.createEventId ?? randomUUID,
    now: options.now ?? (() => new Date()),
  });
  app.addHook("onClose", async () => {
    ledger.close();
  });
  registerRunRoutes(app, runService, operatorToken);

  app.get("/health", async () => ({
    service: "code-nest-controller",
    status: "ok",
  }));

  return app;
}
