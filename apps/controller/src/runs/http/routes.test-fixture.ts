import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildApp } from "../../app.js";

const OPERATOR_TOKEN = "test-operator-token";
const temporaryDirectories: string[] = [];

export const AUTHORIZATION = {
  authorization: `Bearer ${OPERATOR_TOKEN}`,
};

export async function createDatabasePath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "code-nest-runs-"));
  temporaryDirectories.push(directory);
  return join(directory, "events.sqlite");
}

export function lifecycleHeaders(commandId: string): Record<string, string> {
  return { ...AUTHORIZATION, "idempotency-key": commandId };
}

export function appOptions(databasePath: string, startingEventIndex = 0) {
  let eventIndex = startingEventIndex;
  return {
    databasePath,
    operatorToken: OPERATOR_TOKEN,
    logger: false,
    now: () => new Date("2026-09-17T16:00:00.000Z"),
    createEventId: () => `event-${++eventIndex}`,
  };
}

export async function createRun(
  app: ReturnType<typeof buildApp>,
  runId = "run-001",
  commandId = "command-create",
) {
  return app.inject({
    method: "POST",
    url: "/runs",
    headers: lifecycleHeaders(commandId),
    payload: { runId },
  });
}

export async function cleanupRouteFixtures(): Promise<void> {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { force: true, recursive: true });
  }
}
