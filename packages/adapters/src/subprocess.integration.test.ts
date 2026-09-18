import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createSubprocessRuntimeAdapter,
  RuntimeAdapterError,
  type RuntimeMetadata,
} from "./index.js";

const roots: string[] = [];
const startRequest = (path: string) => ({
  match: { runId: "run-subprocess", scenarioId: "station-access" },
  participant: { participantId: "player-a" },
  workspace: { path },
});

const metadata: RuntimeMetadata = {
  adapterName: "subprocess-ndjson",
  adapterVersion: "1.0.0",
  runtimeName: "generic-cli",
  runtimeVersion: "test-fixture",
  modelProvider: "fixture-provider",
  modelName: "fixture-model",
  executionMode: "split",
  observabilityTier: 1,
  capabilities: [
    "interrupt",
    "streaming_output",
    "typed_tool_events",
    "usage_accounting",
    "work_notes",
  ],
};

const COOPERATIVE_CHILD = String.raw`
const readline = require("node:readline");
const lines = readline.createInterface({ input: process.stdin });
const send = (requestId, payload, ok = true) => {
  process.stdout.write(JSON.stringify({
    wireVersion: "1.0", requestId, type: "response", ok, payload,
  }) + "\n");
};
const observe = (requestId, observationId, kind, payload) => {
  process.stdout.write(JSON.stringify({
    wireVersion: "1.0", requestId, type: "observation", ok: true,
    payload: { observationId, kind, payload },
  }) + "\n");
};
console.error("fixture ready");
lines.on("line", (line) => {
  const request = JSON.parse(line);
  if (request.operation === "start") {
    observe(request.requestId, "environment-check", "status", {
      inheritedSecret: Object.hasOwn(process.env, "CODE_NEST_TEST_SECRET"),
      explicitMarker: process.env.SAFE_MARKER ?? null,
    });
    send(request.requestId, { sessionId: request.payload.sessionId });
  } else if (request.operation === "deliver") {
    send(request.requestId, { accepted: true, reason: "accepted" });
  } else if (request.operation === "run") {
    observe(request.requestId, "stdout-1", "stdout", { text: "working" });
    observe(request.requestId, "note-1", "work_note", { body: "Checked policy" });
    send(request.requestId, {
      messages: [{
        messageId: "message-1", channel: "public",
        body: "Review complete", recipientIds: [],
      }],
      commands: [{ kind: "message.publish" }],
      commits: [{ revision: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", summary: "Review access" }],
      toolSummary: { toolCallCount: 1, tools: ["inspect"] },
      usage: { inputTokens: 12, outputTokens: 8, wallTimeMilliseconds: 20 },
      status: "completed",
    });
  } else if (request.operation === "stop") {
    send(request.requestId, { accepted: true, reason: "accepted" });
  }
});
`;

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "code-nest-subprocess-"));
  roots.push(root);
  return root;
}

function adapter(script: string, overrides: Partial<RuntimeMetadata> = {}) {
  return createSubprocessRuntimeAdapter({
    metadata: { ...metadata, ...overrides },
    sessionId: "session-player-a",
    command: process.execPath,
    args: ["-e", script],
    environment: { SAFE_MARKER: "declared" },
    responseTimeoutMilliseconds: 500,
    terminationGraceMilliseconds: 100,
  });
}

afterEach(async () => {
  delete process.env.CODE_NEST_TEST_SECRET;
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("provider-neutral subprocess runtime adapter", () => {
  it("drives a real CLI through strict NDJSON and normalizes Tier 0/1 evidence", async () => {
    process.env.CODE_NEST_TEST_SECRET = "must-not-cross";
    const runtime = adapter(COOPERATIVE_CHILD);
    const path = await workspace();

    expect(await runtime.metadata()).toEqual(metadata);
    expect(await runtime.start(startRequest(path))).toBe("session-player-a");
    expect(await runtime.deliver({
      observationId: "briefing-1",
      kind: "briefing",
      payload: { task: "Inspect access policy" },
    })).toEqual({ accepted: true, reason: "accepted" });
    const turn = await runtime.run({ maximumOutputTokens: 200, wallTimeMilliseconds: 500 });
    expect(turn).toMatchObject({
      status: "completed",
      usage: { inputTokens: 12, outputTokens: 8, wallTimeMilliseconds: 20 },
      commits: [{ revision: "a".repeat(40), summary: "Review access" }],
    });
    expect(runtime.observations()).toEqual(expect.arrayContaining([
      expect.objectContaining({ tier: 0, kind: "stderr", payload: { text: "fixture ready" } }),
      expect.objectContaining({ tier: 0, kind: "status", payload: {
        inheritedSecret: false,
        explicitMarker: "declared",
      } }),
      expect.objectContaining({ tier: 0, kind: "stdout" }),
      expect.objectContaining({ tier: 1, kind: "work_note" }),
    ]));
    expect(await runtime.stop("match_completed")).toEqual({
      sessionId: "session-player-a",
      status: "stopped",
      stopReason: "match_completed",
      turnsCompleted: 1,
      usage: { inputTokens: 12, outputTokens: 8, wallTimeMilliseconds: 20 },
    });
  });

  it("interrupts the real process and still returns a normalized final report", async () => {
    const runtime = adapter(COOPERATIVE_CHILD);
    await runtime.start(startRequest(await workspace()));

    expect(await runtime.interrupt("operator_pause")).toEqual({
      accepted: true,
      reason: "accepted",
    });
    await expect(runtime.run({ maximumOutputTokens: 1, wallTimeMilliseconds: 10 }))
      .rejects.toMatchObject({ code: "ADAPTER_STOPPED" });
    expect(await runtime.stop("operator_pause")).toMatchObject({
      status: "stopped",
      stopReason: "operator_pause",
      turnsCompleted: 0,
    });
  });

  it("fails closed on malformed, oversized, or capability-incompatible output", async () => {
    const malformed = adapter('process.stdin.once("data", () => console.log("not-json"));');
    await expect(malformed.start(startRequest(await workspace())))
      .rejects.toMatchObject({ code: "SUBPROCESS_PROTOCOL_ERROR" });

    const oversized = adapter('process.stdin.once("data", () => console.log("x".repeat(70000)));');
    await expect(oversized.start(startRequest(await workspace())))
      .rejects.toMatchObject({ code: "SUBPROCESS_PROTOCOL_ERROR" });

    expect(() => adapter(COOPERATIVE_CHILD, {
      observabilityTier: 0,
      capabilities: ["streaming_output", "typed_tool_events"],
    })).toThrow();
    expect(() => adapter(COOPERATIVE_CHILD, {
      observabilityTier: 1,
      capabilities: ["streaming_output", "resume"],
    })).toThrow(RuntimeAdapterError);
  });

  it("distinguishes missing executables, process exits, and response timeouts", async () => {
    const missing = createSubprocessRuntimeAdapter({
      metadata,
      sessionId: "missing-session",
      command: join(await workspace(), "does-not-exist"),
    });
    await expect(missing.start(startRequest(await workspace())))
      .rejects.toMatchObject({ code: "SUBPROCESS_START_FAILED" });

    const exits = adapter(`
      const r = require("node:readline").createInterface({ input: process.stdin });
      r.once("line", () => process.exit(7));
    `);
    await expect(exits.start(startRequest(await workspace())))
      .rejects.toMatchObject({ code: "SUBPROCESS_EXITED" });

    const timeout = adapter(`
      require("node:readline").createInterface({ input: process.stdin });
      setInterval(() => {}, 1000);
    `);
    await expect(timeout.start(startRequest(await workspace())))
      .rejects.toMatchObject({ code: "SUBPROCESS_TIMEOUT" });
  });

  it("rejects concurrent requests instead of misattributing responses", async () => {
    const child = COOPERATIVE_CHILD.replace(
      "send(request.requestId, {\n      messages:",
      "setTimeout(() => send(request.requestId, {\n      messages:",
    ).replace(
      "status: \"completed\",\n    });",
      "status: \"completed\",\n    }), 40);",
    );
    const runtime = adapter(child);
    await runtime.start(startRequest(await workspace()));
    const first = runtime.run({ maximumOutputTokens: 200, wallTimeMilliseconds: 500 });
    await expect(runtime.deliver({ observationId: "late", kind: "state", payload: null }))
      .rejects.toMatchObject({ code: "ADAPTER_BUSY" });
    await expect(first).resolves.toMatchObject({ status: "completed" });
    await runtime.stop("done");
  });
});
