import { describe, expect, it } from "vitest";

import {
  RuntimeAdapterError,
  type RuntimeMetadata,
  type TurnResult,
} from "./contract";
import { FakeRuntimeAdapter } from "./fake";

const fullMetadata: RuntimeMetadata = {
  adapterName: "fake",
  adapterVersion: "1.0.0",
  runtimeName: "deterministic-fixture",
  runtimeVersion: "1.0.0",
  modelProvider: "none",
  modelName: "scripted",
  executionMode: "split",
  observabilityTier: 1,
  capabilities: [
    "interrupt",
    "private_message_delivery",
    "resume",
    "typed_tool_events",
    "usage_accounting",
  ],
};

const firstTurn: TurnResult = {
  messages: [
    {
      messageId: "message-001",
      channel: "public",
      body: "I will inspect the access checks.",
      recipientIds: [],
    },
  ],
  commands: [
    {
      protocolVersion: "1.0",
      commandId: "command-001",
      kind: "message.publish",
    },
  ],
  commits: [{ revision: "a".repeat(40), summary: "Tighten access checks" }],
  toolSummary: {
    toolCallCount: 2,
    tools: ["read_file", "run_tests"],
  },
  usage: {
    inputTokens: 120,
    outputTokens: 80,
    wallTimeMilliseconds: 250,
  },
  status: "yielded",
};

function adapter(
  metadata: RuntimeMetadata = fullMetadata,
): FakeRuntimeAdapter {
  return new FakeRuntimeAdapter({
    metadata,
    sessionId: "session-player-a",
    turns: [firstTurn],
  });
}

const startRequest = {
  match: { runId: "run-001", scenarioId: "station-access" },
  participant: { participantId: "player-a" },
  workspace: { path: "/workspace/player-a" },
} as const;

describe("deterministic fake runtime adapter", () => {
  it("drives metadata, start, observation, turn, and stop deterministically", async () => {
    const fake = adapter();

    expect(await fake.metadata()).toEqual(fullMetadata);
    expect(await fake.start(startRequest)).toBe("session-player-a");
    expect(
      await fake.deliver({
        observationId: "observation-001",
        kind: "briefing",
        payload: { task: "Repair access checks" },
      }),
    ).toEqual({ accepted: true, reason: "accepted" });
    expect(
      await fake.run({
        maximumOutputTokens: 1_000,
        wallTimeMilliseconds: 5_000,
      }),
    ).toEqual(firstTurn);
    expect(await fake.stop("match_completed")).toEqual({
      sessionId: "session-player-a",
      status: "stopped",
      stopReason: "match_completed",
      turnsCompleted: 1,
      usage: firstTurn.usage,
    });
    expect(fake.transcript()).toEqual([
      { operation: "start", value: startRequest },
      {
        operation: "deliver",
        value: {
          observationId: "observation-001",
          kind: "briefing",
          payload: { task: "Repair access checks" },
        },
      },
      {
        operation: "run",
        value: {
          maximumOutputTokens: 1_000,
          wallTimeMilliseconds: 5_000,
        },
      },
      { operation: "stop", value: "match_completed" },
    ]);
  });

  it("returns copies so callers cannot rewrite scripted evidence", async () => {
    const fake = adapter();
    await fake.start(startRequest);

    const result = await fake.run({
      maximumOutputTokens: 1_000,
      wallTimeMilliseconds: 5_000,
    });
    const returnedMessage = result.messages[0];
    if (returnedMessage === undefined) throw new Error("Expected one message.");
    (returnedMessage as { body: string }).body = "rewritten";
    (result.commands as unknown[]).push({ invented: true });

    expect(firstTurn.messages[0]?.body).toBe(
      "I will inspect the access checks.",
    );
    expect(firstTurn.commands).toHaveLength(1);
  });

  it("exposes unsupported observability as null or unavailable", async () => {
    const minimalMetadata: RuntimeMetadata = {
      ...fullMetadata,
      observabilityTier: 0,
      capabilities: [],
    };
    const fake = new FakeRuntimeAdapter({
      metadata: minimalMetadata,
      sessionId: "session-minimal",
      turns: [
        {
          ...firstTurn,
          commands: [],
          toolSummary: null,
          usage: null,
        },
      ],
    });
    await fake.start(startRequest);

    const result = await fake.run({
      maximumOutputTokens: 1_000,
      wallTimeMilliseconds: 5_000,
    });
    expect(result.commands).toEqual([]);
    expect(result.toolSummary).toBeNull();
    expect(result.usage).toBeNull();
    expect(await fake.interrupt("operator_pause")).toEqual({
      accepted: false,
      reason: "unsupported",
    });
  });

  it("rejects scripts that contradict declared observability", () => {
    expect(
      () =>
        new FakeRuntimeAdapter({
          metadata: { ...fullMetadata, capabilities: ["usage_accounting"] },
          sessionId: "session-invalid",
          turns: [firstTurn],
        }),
    ).toThrowError(RuntimeAdapterError);
  });

  it("interrupts and resumes only when those capabilities are declared", async () => {
    const fake = adapter();
    await fake.start(startRequest);

    expect(await fake.interrupt("operator_pause")).toEqual({
      accepted: true,
      reason: "accepted",
    });
    expect(
      await fake.run({
        maximumOutputTokens: 1_000,
        wallTimeMilliseconds: 5_000,
      }),
    ).toEqual(firstTurn);
  });

  it("does not invent resume support after a successful interrupt", async () => {
    const fake = adapter({
      ...fullMetadata,
      capabilities: fullMetadata.capabilities.filter(
        (capability) => capability !== "resume",
      ),
    });
    await fake.start(startRequest);
    await fake.interrupt("operator_pause");

    await expect(
      fake.run({
        maximumOutputTokens: 1_000,
        wallTimeMilliseconds: 5_000,
      }),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_OPERATION" });
  });

  it("rejects invalid lifecycle order and exhausted scripts", async () => {
    const fake = adapter();
    await expect(
      fake.run({ maximumOutputTokens: 1, wallTimeMilliseconds: 1 }),
    ).rejects.toMatchObject({ code: "ADAPTER_NOT_STARTED" });

    await fake.start(startRequest);
    await expect(fake.start(startRequest)).rejects.toMatchObject({
      code: "ADAPTER_ALREADY_STARTED",
    });
    await fake.run({ maximumOutputTokens: 1, wallTimeMilliseconds: 1 });
    await expect(
      fake.run({ maximumOutputTokens: 1, wallTimeMilliseconds: 1 }),
    ).rejects.toMatchObject({ code: "FAKE_SCRIPT_EXHAUSTED" });
    await fake.stop("done");
    await expect(
      fake.deliver({
        observationId: "late",
        kind: "state",
        payload: null,
      }),
    ).rejects.toBeInstanceOf(RuntimeAdapterError);
  });
});
