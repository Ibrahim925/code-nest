import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  OmpRuntimeAdapter,
  RuntimeAdapterError,
  type OmpComputerCapturePort,
  type OmpObservabilityFact,
  type OmpObservabilitySink,
} from "./index.js";
import { NodeProcessLauncher } from "./subprocess/node/node-process-launcher.js";

const roots: string[] = [];
const BROKER_GRANT = "short-lived-secret-grant";
const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);

const OBSERVABLE_OMP_FIXTURE = String.raw`
const readline = require("node:readline");
const input = readline.createInterface({ input: process.stdin });
let prompts = 0;
let lastText = null;
let pending = null;
const send = (frame) => process.stdout.write(JSON.stringify(frame) + "\n");
const response = (request, data) => send({
  type: "response", id: request.id, command: request.type, success: true, data,
});
const stats = () => ({ tokens: { input: prompts * 5, output: prompts * 3 } });
send({ type: "ready", protocolVersion: 1, supportedProtocolVersions: [1] });
input.on("line", (line) => {
  const request = JSON.parse(line);
  if (request.type === "get_state") {
    response(request, { sessionId: "omp-live", model: {
      provider: "openai", id: "gpt-5.6-luna",
    } });
  } else if (request.type === "set_host_tools") {
    response(request, { toolNames: request.tools.map((tool) => tool.name) });
  } else if (request.type === "get_session_stats") {
    response(request, stats());
  } else if (request.type === "get_last_assistant_text") {
    response(request, { text: lastText });
  } else if (request.type === "prompt") {
    prompts += 1;
    response(request, { agentInvoked: true });
    send({ type: "tool_execution_start", toolCallId: "read-1", toolName: "read",
      args: { credential: process.env.BROKER_GRANT } });
    send({ type: "tool_execution_end", toolCallId: "read-1", toolName: "read",
      result: { secret: process.env.BROKER_GRANT }, isError: false });
    pending = "rationale";
    send({ type: "host_tool_call", id: "host-rationale", toolCallId: "rationale-1",
      toolName: "code_nest_submit_rationale",
      arguments: { body: "I checked the smallest relevant boundary." } });
  } else if (request.type === "host_tool_result" && pending === "rationale") {
    pending = "memory";
    send({ type: "host_tool_call", id: "host-memory", toolCallId: "memory-1",
      toolName: "code_nest_update_memory", arguments: {
        reason: "agent_consolidation", summary: "Saved the next check.",
        content: "Inspect the policy test next.",
      } });
  } else if (request.type === "host_tool_result" && pending === "memory") {
    pending = null;
    lastText = "Completed the assigned check.";
    send({ type: "message_update", message: { role: "assistant", content: [{
      type: "thinking", thinking: "PRIVATE_THOUGHT_SHOULD_NOT_SURFACE",
    }] } });
    send({ type: "agent_end", messages: [{ role: "assistant", stopReason: "stop" }] });
  }
});
process.on("SIGTERM", () => process.exit(0));
`;

class RecordingSink implements OmpObservabilitySink {
  readonly facts: OmpObservabilityFact[] = [];

  async record(fact: OmpObservabilityFact): Promise<void> {
    this.facts.push(structuredClone(fact));
  }
}

class SequencedCapture implements OmpComputerCapturePort {
  calls = 0;

  async capture() {
    this.calls += 1;
    if (this.calls === 1) {
      return {
        status: "visible" as const,
        bytes: png,
        width: 1,
        height: 1,
        redactionStatus: "redacted" as const,
      };
    }
    if (this.calls === 2) throw new Error("fixture capture failure");
    return { status: "withheld" as const, reason: "suspected_secret" as const };
  }
}

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "code-nest-omp-observability-"));
  roots.push(root);
  return root;
}

function configuration() {
  return {
    sessionId: "omp-player-a",
    runtimeVersion: "18.1.14",
    modelProvider: "openai",
    modelName: "gpt-5.6-luna",
    modelSelector: "openai/gpt-5.6-luna",
    command: process.execPath,
    commandArgs: ["-e", OBSERVABLE_OMP_FIXTURE, "--"],
    environment: { BROKER_GRANT },
    responseTimeoutMilliseconds: 500,
    startupTimeoutMilliseconds: 500,
    terminationGraceMilliseconds: 100,
  } as const;
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe("OMP Observatory telemetry bridge", () => {
  it("streams safe activity, tools, submissions, action frames, and heartbeat frames", async () => {
    const sink = new RecordingSink();
    const capture = new SequencedCapture();
    const runtime = new OmpRuntimeAdapter(
      configuration(),
      new NodeProcessLauncher(),
      { sink, computerCapture: capture, heartbeatMilliseconds: 1_000 },
    );
    await runtime.start({
      match: { runId: "run-001", scenarioId: "station-access" },
      participant: { participantId: "player-a" },
      workspace: { path: await workspace() },
    });
    await new Promise((resolve) => setTimeout(resolve, 1_050));
    await runtime.run({ maximumOutputTokens: 100, wallTimeMilliseconds: 1_000 });
    await runtime.stop("round_completed");

    const activities = sink.facts.flatMap((fact) =>
      fact.observation.kind === "activity" ? [fact.observation.state] : [],
    );
    expect(activities).toEqual([
      "starting",
      "waiting",
      "working",
      "waiting",
      "stopped",
    ]);
    expect(sink.facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "participant",
          observation: {
            kind: "rationale",
            body: "I checked the smallest relevant boundary.",
          },
        }),
        expect.objectContaining({
          source: "participant",
          observation: expect.objectContaining({
            kind: "memory",
            summary: "Saved the next check.",
          }),
        }),
        expect.objectContaining({
          source: "runtime",
          observation: expect.objectContaining({
            kind: "tool",
            toolCallId: "read-1",
            summary: null,
          }),
        }),
      ]),
    );
    const frames = sink.facts.flatMap((fact) =>
      fact.observation.kind === "computer_frame" ? [fact.observation] : [],
    );
    expect(frames.some((frame) => frame.captureReason === "heartbeat")).toBe(true);
    expect(frames).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          frame: expect.objectContaining({ status: "visible", redactionStatus: "redacted" }),
        }),
        expect.objectContaining({
          frame: { status: "withheld", reason: "capture_failed" },
        }),
        expect.objectContaining({
          frame: { status: "withheld", reason: "suspected_secret" },
        }),
      ]),
    );
    const serialized = JSON.stringify(sink.facts);
    expect(serialized).not.toContain(BROKER_GRANT);
    expect(serialized).not.toContain("PRIVATE_THOUGHT_SHOULD_NOT_SURFACE");
    expect(serialized).not.toContain("args");
    expect(serialized).not.toContain("result");
  });

  it("rejects an unsafe heartbeat interval before starting OMP", () => {
    expect(
      () =>
        new OmpRuntimeAdapter(
          configuration(),
          new NodeProcessLauncher(),
          { heartbeatMilliseconds: 999 },
        ),
    ).toThrowError(RuntimeAdapterError);
  });
});
