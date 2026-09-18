import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  OmpRuntimeAdapter,
  RuntimeAdapterError,
  type OmpConfiguration,
} from "./index.js";
import type {
  ProcessLaunchRequest,
  ProcessLauncher,
  ProcessSession,
} from "./subprocess/application/process-session.js";
import { NodeProcessLauncher } from "./subprocess/node/node-process-launcher.js";

const roots: string[] = [];
const TOKEN = "short-lived-broker-grant";

const OMP_FIXTURE = String.raw`
const readline = require("node:readline");
const input = readline.createInterface({ input: process.stdin });
let prompts = 0;
let lastText = null;
let waiting = false;
let pendingHost = null;
const send = (frame) => process.stdout.write(JSON.stringify(frame) + "\n");
const response = (request, data) => send({
  type: "response", id: request.id, command: request.type, success: true, data,
});
const stats = () => ({
  sessionId: "omp-internal", userMessages: prompts, assistantMessages: prompts,
  toolCalls: prompts, toolResults: prompts, totalMessages: prompts * 2,
  tokens: { input: prompts * 11, output: prompts * 7, reasoning: 0,
    cacheRead: 0, cacheWrite: 0, total: prompts * 18 },
  premiumRequests: 0, cost: 0,
});
const finish = (stopReason = "stop") => {
  send({ type: "message_update", message: { role: "assistant",
    content: [{ type: "thinking", thinking: "PRIVATE_THOUGHT_SHOULD_NOT_SURFACE" }] },
    assistantMessageEvent: { type: "thinking_delta", delta: "PRIVATE" } });
  send({ type: "agent_end", messages: [{ role: "assistant", stopReason }] });
};
send({ type: "ready", protocolVersion: 1, supportedProtocolVersions: [1, 2],
  maxFrameBytes: 1048576, maxReassembledFrameBytes: 1048576 });
console.error(process.env.CODE_NEST_TEST_SECRET || "fixture-ready");
input.on("line", (line) => {
  const request = JSON.parse(line);
  if (request.type === "get_state") {
    response(request, { sessionId: "omp-internal",
      model: { provider: "openai", id: "gpt-5.6-luna" } });
  } else if (request.type === "set_host_tools") {
    response(request, { toolNames: request.tools.map((tool) => tool.name) });
  } else if (request.type === "get_session_stats") {
    response(request, stats());
  } else if (request.type === "get_last_assistant_text") {
    response(request, { text: lastText });
  } else if (request.type === "prompt") {
    prompts += 1;
    response(request, { agentInvoked: true });
    if (request.message.includes("wait-for-interrupt")) {
      waiting = true;
      send({ type: "tool_execution_start", toolCallId: "wait-tool", toolName: "read",
        args: {} });
      return;
    }
    send({ type: "tool_execution_start", toolCallId: "read-tool", toolName: "read",
      args: { secret: process.env.BROKER_GRANT } });
    send({ type: "tool_execution_end", toolCallId: "read-tool", toolName: "read",
      result: { content: "private" }, isError: false });
    pendingHost = "host-call-" + prompts;
    send({ type: "host_tool_call", id: pendingHost, toolCallId: "submit-tool",
      toolName: "code_nest_submit_command",
      arguments: { command: { type: "message.publish", body: "Ready for review" } } });
  } else if (request.type === "host_tool_result" && request.id === pendingHost) {
    lastText = "Completed assigned work.";
    pendingHost = null;
    finish();
  } else if (request.type === "abort") {
    response(request);
    if (waiting) {
      waiting = false;
      lastText = "Interrupted safely.";
      finish("aborted");
    }
  }
});
process.on("SIGTERM", () => process.exit(0));
`;

class RecordingLauncher implements ProcessLauncher {
  request: ProcessLaunchRequest | undefined;
  readonly #delegate = new NodeProcessLauncher();

  async launch(request: ProcessLaunchRequest): Promise<ProcessSession> {
    this.request = request;
    return this.#delegate.launch(request);
  }
}

function configuration(overrides: Partial<OmpConfiguration> = {}): OmpConfiguration {
  return {
    sessionId: "omp-player-a",
    runtimeVersion: "18.1.14",
    modelProvider: "openai",
    modelName: "gpt-5.6-luna",
    modelSelector: "openai/gpt-5.6-luna",
    command: process.execPath,
    commandArgs: ["-e", OMP_FIXTURE, "--"],
    environment: { SAFE_MARKER: "declared", BROKER_GRANT: TOKEN },
    responseTimeoutMilliseconds: 500,
    startupTimeoutMilliseconds: 500,
    terminationGraceMilliseconds: 100,
    ...overrides,
  };
}

function startRequest(path: string) {
  return {
    match: { runId: "omp-run", scenarioId: "station-access" },
    participant: { participantId: "player-a" },
    workspace: { path },
  };
}

async function workspace(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "code-nest-omp-"));
  roots.push(path);
  return path;
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Timed out waiting for fixture evidence.");
}

afterEach(async () => {
  delete process.env.CODE_NEST_TEST_SECRET;
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("OMP RPC harness connector", () => {
  it("maps a contained OMP turn without leaking credentials or private thinking", async () => {
    process.env.CODE_NEST_TEST_SECRET = "host-secret-must-not-cross";
    const launcher = new RecordingLauncher();
    const runtime = new OmpRuntimeAdapter(configuration(), launcher);
    expect(await runtime.metadata()).toMatchObject({
      adapterName: "omp-rpc",
      runtimeName: "omp",
      modelProvider: "openai",
      modelName: "gpt-5.6-luna",
      executionMode: "contained",
      observabilityTier: 1,
    });
    expect(await runtime.start(startRequest(await workspace()))).toBe("omp-player-a");
    const launch = launcher.request as ProcessLaunchRequest;
    expect(launch.environment).toEqual({ SAFE_MARKER: "declared", BROKER_GRANT: TOKEN });
    expect(launch.environment).not.toHaveProperty("CODE_NEST_TEST_SECRET");
    expect(launch.args).toEqual(expect.arrayContaining([
      "--mode", "rpc", "--model", "openai/gpt-5.6-luna", "--no-session",
      "--no-extensions", "--no-skills", "--approval-mode", "yolo",
    ]));
    expect(JSON.stringify(launch.args)).not.toContain(TOKEN);

    await runtime.deliver({
      observationId: "briefing-1",
      kind: "private-briefing",
      payload: { assignment: "Review policy" },
    });
    const turn = await runtime.run({ maximumOutputTokens: 100, wallTimeMilliseconds: 1_000 });
    expect(turn).toMatchObject({
      status: "completed",
      messages: [],
      commits: [],
      commands: [{ type: "message.publish", body: "Ready for review" }],
      usage: { inputTokens: 11, outputTokens: 7 },
      toolSummary: { toolCallCount: 1, tools: ["read"] },
    });
    const serialized = JSON.stringify(runtime.observations());
    expect(serialized).toContain("Completed assigned work.");
    expect(serialized).not.toContain(TOKEN);
    expect(serialized).not.toContain("PRIVATE_THOUGHT_SHOULD_NOT_SURFACE");
    expect(serialized).not.toContain("host-secret-must-not-cross");
    expect(await runtime.stop("round_completed")).toMatchObject({
      turnsCompleted: 1,
      usage: { inputTokens: 11, outputTokens: 7 },
    });
  });

  it("interrupts one turn and resumes the same standalone OMP session", async () => {
    const runtime = new OmpRuntimeAdapter(configuration(), new NodeProcessLauncher());
    await runtime.start(startRequest(await workspace()));
    await runtime.deliver({
      observationId: "pause-case",
      kind: "work",
      payload: "wait-for-interrupt",
    });
    const interrupted = runtime.run({ maximumOutputTokens: 100, wallTimeMilliseconds: 1_000 });
    await waitFor(() => runtime.observations().some((item) =>
      item.kind === "tool_call" && JSON.stringify(item.payload).includes("wait-tool")
    ));
    expect(await runtime.interrupt("operator_pause")).toEqual({
      accepted: true,
      reason: "accepted",
    });
    await expect(interrupted).resolves.toMatchObject({ status: "interrupted" });
    await runtime.deliver({ observationId: "resume-case", kind: "work", payload: "continue" });
    await expect(runtime.run({ maximumOutputTokens: 100, wallTimeMilliseconds: 1_000 }))
      .resolves.toMatchObject({ status: "completed" });
    await runtime.stop("done");
  });

  it("rejects invalid configuration, observations, model fallback, and budget overrun", async () => {
    expect(() => new OmpRuntimeAdapter(
      configuration({ modelSelector: "bad selector" }),
      new NodeProcessLauncher(),
    )).toThrow(RuntimeAdapterError);

    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    const runtime = new OmpRuntimeAdapter(configuration(), new NodeProcessLauncher());
    await runtime.start(startRequest(await workspace()));
    await expect(runtime.deliver({ observationId: "cyclic", kind: "work", payload: cyclic }))
      .rejects.toMatchObject({ code: "INVALID_ADAPTER_INPUT" });
    await expect(runtime.run({ maximumOutputTokens: 6, wallTimeMilliseconds: 1_000 }))
      .rejects.toMatchObject({ code: "INVALID_ADAPTER_INPUT" });

    const wrongModel = new OmpRuntimeAdapter(configuration({
      commandArgs: ["-e", OMP_FIXTURE.replace('id: "gpt-5.6-luna"', 'id: "gpt-5.6-terra"'), "--"],
    }), new NodeProcessLauncher());
    await expect(wrongModel.start(startRequest(await workspace())))
      .rejects.toMatchObject({ code: "SUBPROCESS_PROTOCOL_ERROR" });
  });

  it("fails closed on malformed RPC and a missing OMP executable", async () => {
    const malformed = new OmpRuntimeAdapter(configuration({
      commandArgs: ["-e", 'console.log("not-json"); setInterval(() => {}, 1000);', "--"],
    }), new NodeProcessLauncher());
    await expect(malformed.start(startRequest(await workspace())))
      .rejects.toMatchObject({ code: "SUBPROCESS_PROTOCOL_ERROR" });

    const missing = new OmpRuntimeAdapter(configuration({
      command: join(await workspace(), "missing-omp"),
      commandArgs: [],
    }), new NodeProcessLauncher());
    await expect(missing.start(startRequest(await workspace())))
      .rejects.toMatchObject({ code: "SUBPROCESS_START_FAILED" });
  });
});
