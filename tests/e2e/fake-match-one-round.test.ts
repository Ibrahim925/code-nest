import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { projectEventForAudience } from "../../packages/core/src/index.js";
import { afterEach, describe, expect, it } from "vitest";

import { EventLedger } from "../../apps/controller/src/ledger/ledger.js";
import {
  cleanupFakeMatchContexts,
  createFakeMatchContext,
} from "./fake-match-one-round.fixture.js";

const execFileAsync = promisify(execFile);

afterEach(cleanupFakeMatchContexts);

describe("one-round four-agent fake match", () => {
  it("builds a passing integrated candidate and a sealed replay", async () => {
    const context = await createFakeMatchContext();
    const testRun = await execFileAsync("node", ["--test"], {
      cwd: context.result.candidatePath,
      encoding: "utf8",
    });

    expect(testRun.stdout).toMatch(/pass 6\b/);
    expect(testRun.stdout).toMatch(/fail 0\b/);
    expect(context.result.participants).toHaveLength(4);

    const events = context.ledger.listEvents(context.result.runId);
    expect(events.map(({ kind }) => kind)).toEqual([
      "run.created",
      "match.workspaces_ready",
      "runtime.started",
      "runtime.started",
      "runtime.started",
      "runtime.started",
      "briefing.delivery_started",
      "briefing.completed",
      "runtime.stopped",
      "participant.work_captured",
      "runtime.stopped",
      "participant.work_captured",
      "runtime.stopped",
      "participant.work_captured",
      "runtime.stopped",
      "participant.work_captured",
      "integration.completed",
      "match.completed",
    ]);
    expect(JSON.stringify(events)).not.toContain(context.secretObjective);
    expect(JSON.stringify(events)).not.toContain("candidatePath");

    const visible = events.flatMap((event) =>
      projectEventForAudience(event, {
        runId: context.result.runId,
        revealState: "sealed",
        audience: { kind: "observer", mode: "clean" },
      }) ?? [],
    );
    expect(visible.map(({ kind }) => kind)).not.toContain(
      "briefing.delivery_started",
    );
    expect(visible).toHaveLength(events.length - 1);

    const storedReport = await context.artifacts.read({
      runId: context.result.runId,
      digest: context.result.integrationReportDigest,
      revealState: "sealed",
      audience: { kind: "observer", mode: "clean" },
    });
    expect(storedReport).toBeDefined();
    const reportText = Buffer.from(storedReport?.bytes ?? []).toString("utf8");
    expect(reportText).not.toContain("candidatePath");
    expect(reportText).not.toContain(context.secretObjective);
    expect(JSON.parse(reportText)).toMatchObject({
      candidateRevision: context.result.candidateRevision,
      outcomes: [
        { participantId: "player-a", status: "integrated" },
        { participantId: "player-b", status: "integrated" },
        { participantId: "player-c", status: "integrated" },
        { participantId: "player-d", status: "integrated" },
      ],
    });

    for (const runtime of context.runtimes.instances.values()) {
      expect(runtime.transcript().map(({ operation }) => operation)).toEqual([
        "start",
        "deliver",
        "run",
        "stop",
      ]);
    }

    context.ledger.close();
    const replay = EventLedger.open(context.databasePath);
    expect(replay.listEvents(context.result.runId)).toEqual(events);
    replay.close();
  });

  it("repeats the same candidate and public trace from the same inputs", async () => {
    const first = await createFakeMatchContext("run-repeatable");
    const second = await createFakeMatchContext("run-repeatable");

    expect(second.result.candidateRevision).toBe(first.result.candidateRevision);
    expect(second.result.integrationReportDigest).toBe(
      first.result.integrationReportDigest,
    );
    expect(second.ledger.listEvents("run-repeatable")).toEqual(
      first.ledger.listEvents("run-repeatable"),
    );
  });
});
