import { createHash, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

import Fastify, { type FastifyInstance } from "fastify";

import { EventLedgerEventSource } from "./events/adapters/event-ledger-event-source.js";
import { EventStreamService } from "./events/application/event-stream.js";
import { registerSseRoutes } from "./events/http/sse.js";
import { ArtifactStoreEvidenceReader } from "./evidence/adapters/artifact-store-evidence-reader.js";
import { ReadArtifactEvidenceService } from "./evidence/application/read-artifact-evidence.js";
import { registerArtifactRoutes } from "./evidence/http/artifacts.js";
import { EventLedger } from "./ledger/ledger.js";
import { EventLedgerObserverModeStore } from "./observer/adapters/event-ledger-observer-mode-store.js";
import { ObserverModeService } from "./observer/application/observer-mode.js";
import { registerObserverModeRoutes } from "./observer/http/modes.js";
import { LedgerReplaySource } from "./replay/adapters/ledger-replay-source.js";
import { ExportReplayService } from "./replay/application/export-replay.js";
import { registerReplayRoutes } from "./replay/http/replay.js";
import { EventLedgerRunStore } from "./runs/adapters/event-ledger-run-store.js";
import { RunLifecycleService } from "./runs/application/run-lifecycle.js";
import { registerRunRoutes } from "./runs/http/routes.js";

export interface BuildAppOptions {
  readonly databasePath?: string;
  readonly artifactRoot?: string;
  readonly operatorToken?: string;
  readonly observerToken?: string;
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
  const configuredObserverToken =
    options.observerToken ?? process.env.CODE_NEST_OBSERVER_TOKEN;
  const observerToken = configuredObserverToken ?? randomUUID();
  if (configuredObserverToken === undefined) {
    app.log.warn(
      { observerToken },
      "Generated an ephemeral local observer token for this controller process.",
    );
  }
  if (observerToken === operatorToken) {
    throw new Error("Operator and observer tokens must be distinct.");
  }
  const createEventId = options.createEventId ?? randomUUID;
  const now = options.now ?? (() => new Date());
  const ledger = EventLedger.open(databasePath);
  const artifactRoot = options.artifactRoot ?? (
    options.databasePath === undefined
      ? ".code-nest/artifacts"
      : join(dirname(databasePath), "artifacts")
  );
  const artifactService = new ReadArtifactEvidenceService(
    new ArtifactStoreEvidenceReader(artifactRoot),
  );
  const observerModes = new ObserverModeService({
    store: new EventLedgerObserverModeStore(ledger),
    now,
    createEventId,
  });
  const eventSource = new EventLedgerEventSource(ledger);
  const eventStreamService = new EventStreamService(eventSource);
  const runStore = new EventLedgerRunStore(ledger);
  const runService = new RunLifecycleService({
    store: runStore,
    createEventId,
    now,
  });
  app.addHook("onClose", async () => {
    ledger.close();
  });
  registerSseRoutes(app, eventStreamService, {
    observerToken,
    operatorToken,
    observerModes,
  });
  registerArtifactRoutes(app, artifactService, {
    observerToken,
    operatorToken,
    observerModes,
  });
  registerObserverModeRoutes(app, observerModes, { observerToken, operatorToken });
  registerReplayRoutes(app, new ExportReplayService(
    new LedgerReplaySource(ledger, artifactRoot),
  ), { observerToken, operatorToken, observerModes });
  registerRunRoutes(app, runService, operatorToken, (runId, sourceCommandId) => {
    const digest = createHash("sha256").update(sourceCommandId).digest("hex").slice(0, 24);
    observerModes.unblind(runId, `configured-unblind-${digest}`);
  });

  app.get("/health", async () => ({
    service: "code-nest-controller",
    status: "ok",
  }));

  return app;
}
