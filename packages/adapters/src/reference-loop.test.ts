import { describe, expect, it } from "vitest";

import {
  ReferenceLoopAdapter,
  RuntimeAdapterError,
  type ReferenceModelProvider,
  type ReferenceProviderRequest,
} from "./index.js";

type ProviderScript = (request: ReferenceProviderRequest) => unknown | Promise<unknown>;

class DeterministicProvider implements ReferenceModelProvider {
  readonly calls: ReferenceProviderRequest[] = [];

  constructor(private readonly scripts: ProviderScript[]) {}

  async complete(request: ReferenceProviderRequest): Promise<unknown> {
    this.calls.push({ ...request, observations: structuredClone(request.observations), budget: { ...request.budget } });
    const script = this.scripts.shift();
    if (script === undefined) throw new Error("Provider script exhausted.");
    return script(request);
  }
}

function response(overrides: Record<string, unknown> = {}) {
  return {
    messages: [{ messageId: "message-1", channel: "public", body: "Ready to apply", recipientIds: [] }],
    commands: [{ kind: "file.write", path: "answer.txt", contents: "done" }],
    toolSummary: { toolCallCount: 1, tools: ["file.write"] },
    usage: { inputTokens: 12, outputTokens: 7 },
    status: "completed",
    reasoningSummary: "Provider-supplied plan summary.",
    ...overrides,
  };
}

function startRequest() {
  return {
    match: { runId: "run-reference", scenarioId: "station-access" },
    participant: { participantId: "participant-a" },
    workspace: { path: "/tmp/reference-workspace" },
  };
}

describe("direct reference model loop", () => {
  it("completes a provider-neutral turn with measured usage and explicit provenance", async () => {
    let now = 100;
    const provider = new DeterministicProvider([
      () => {
        now = 125;
        return response();
      },
    ]);
    const adapter = new ReferenceLoopAdapter({
      sessionId: "reference-session",
      provider,
      providerName: "deterministic-provider",
      modelName: "fixture-model",
      providerReasoningSummaries: true,
      now: () => now,
    });

    await expect(adapter.metadata()).resolves.toMatchObject({
      adapterName: "reference-loop",
      executionMode: "split",
      observabilityTier: 2,
      capabilities: expect.arrayContaining([
        "provider_reasoning_summaries", "typed_tool_events", "usage_accounting",
      ]),
    });
    await expect(adapter.start(startRequest())).resolves.toBe("reference-session");
    await expect(adapter.deliver({
      observationId: "brief-1",
      kind: "private_message",
      payload: { body: "sealed assignment" },
    })).resolves.toEqual({ accepted: true, reason: "accepted" });
    const turn = await adapter.run({ maximumOutputTokens: 20, wallTimeMilliseconds: 1_000 });

    expect(turn).toMatchObject({
      status: "completed",
      commits: [],
      usage: { inputTokens: 12, outputTokens: 7, wallTimeMilliseconds: 25 },
      toolSummary: { toolCallCount: 1, tools: ["file.write"] },
    });
    expect("reasoningSummary" in turn).toBe(false);
    expect(provider.calls[0]).toMatchObject({
      sessionId: "reference-session",
      turnIndex: 1,
      runId: "run-reference",
      participantId: "participant-a",
      observations: [{ observationId: "brief-1", kind: "private_message" }],
    });
    expect(adapter.observations()).toMatchObject([
      { tier: 1, kind: "command" },
      { tier: 1, kind: "message" },
      { tier: 0, kind: "status" },
    ]);
    expect(adapter.nativeObservations()).toEqual([
      {
        observationId: "turn-1-usage",
        kind: "provider_usage",
        provenance: "provider_reported",
        turnIndex: 1,
        usage: { inputTokens: 12, outputTokens: 7, wallTimeMilliseconds: 25 },
      },
      {
        observationId: "turn-1-summary",
        kind: "provider_reasoning_summary",
        provenance: "provider_supplied",
        turnIndex: 1,
        text: "Provider-supplied plan summary.",
      },
    ]);
    await expect(adapter.stop("match_complete")).resolves.toMatchObject({
      turnsCompleted: 1,
      usage: { inputTokens: 12, outputTokens: 7, wallTimeMilliseconds: 25 },
    });
  });

  it("rejects private reasoning, undeclared summaries, and output-budget overruns", async () => {
    const privateReasoning = new ReferenceLoopAdapter({
      sessionId: "private-reasoning",
      provider: new DeterministicProvider([() => ({ ...response(), privateChainOfThought: "never expose" })]),
      providerName: "fixture",
      modelName: "fixture",
      providerReasoningSummaries: true,
    });
    await privateReasoning.start(startRequest());
    await expect(privateReasoning.run({ maximumOutputTokens: 20, wallTimeMilliseconds: 1_000 }))
      .rejects.toMatchObject({ code: "INVALID_ADAPTER_INPUT" });

    const summariesDisabled = new ReferenceLoopAdapter({
      sessionId: "summaries-disabled",
      provider: new DeterministicProvider([() => response()]),
      providerName: "fixture",
      modelName: "fixture",
    });
    await summariesDisabled.start(startRequest());
    await expect(summariesDisabled.run({ maximumOutputTokens: 20, wallTimeMilliseconds: 1_000 }))
      .rejects.toMatchObject({ code: "INVALID_ADAPTER_INPUT" });

    const overBudget = new ReferenceLoopAdapter({
      sessionId: "over-budget",
      provider: new DeterministicProvider([() => response({ reasoningSummary: null })]),
      providerName: "fixture",
      modelName: "fixture",
    });
    await overBudget.start(startRequest());
    await expect(overBudget.run({ maximumOutputTokens: 6, wallTimeMilliseconds: 1_000 }))
      .rejects.toMatchObject({ code: "INVALID_ADAPTER_INPUT" });

    const nonCloneable = new ReferenceLoopAdapter({
      sessionId: "non-cloneable",
      provider: new DeterministicProvider([() => response({
        commands: [() => "not a command value"],
        reasoningSummary: null,
      })]),
      providerName: "fixture",
      modelName: "fixture",
    });
    await nonCloneable.start(startRequest());
    await expect(nonCloneable.run({ maximumOutputTokens: 20, wallTimeMilliseconds: 1_000 }))
      .rejects.toMatchObject({ code: "INVALID_ADAPTER_INPUT" });
    await expect(nonCloneable.stop("done")).resolves.toMatchObject({ turnsCompleted: 0 });
  });

  it("interrupts an active provider call, resumes, and marks aggregate usage incomplete", async () => {
    let callStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => { callStarted = resolve; });
    const provider = new DeterministicProvider([
      (request) => new Promise((_, reject) => {
        callStarted?.();
        request.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      }),
      () => response({ reasoningSummary: null }),
    ]);
    const adapter = new ReferenceLoopAdapter({
      sessionId: "interruptible",
      provider,
      providerName: "fixture",
      modelName: "fixture",
    });
    await adapter.start(startRequest());
    const pending = adapter.run({ maximumOutputTokens: 20, wallTimeMilliseconds: 10_000 });
    await started;
    await expect(adapter.interrupt("operator_pause")).resolves.toEqual({ accepted: true, reason: "accepted" });
    await expect(pending).resolves.toMatchObject({ status: "interrupted", usage: null });
    await expect(adapter.run({ maximumOutputTokens: 20, wallTimeMilliseconds: 1_000 }))
      .resolves.toMatchObject({ status: "completed" });
    await expect(adapter.stop("done")).resolves.toMatchObject({ turnsCompleted: 1, usage: null });
  });

  it("bounds provider wall time and enforces lifecycle ordering", async () => {
    const provider = new DeterministicProvider([
      (request) => new Promise((_, reject) => {
        request.signal.addEventListener("abort", () => reject(new Error("deadline")), { once: true });
      }),
    ]);
    const adapter = new ReferenceLoopAdapter({
      sessionId: "deadline-session",
      provider,
      providerName: "fixture",
      modelName: "fixture",
    });
    await expect(adapter.run({ maximumOutputTokens: 1, wallTimeMilliseconds: 10 }))
      .rejects.toBeInstanceOf(RuntimeAdapterError);
    await adapter.start(startRequest());
    await expect(adapter.run({ maximumOutputTokens: 1, wallTimeMilliseconds: 10 }))
      .rejects.toMatchObject({ code: "INVALID_ADAPTER_INPUT" });
    await expect(adapter.interrupt("late_interrupt")).resolves.toEqual({ accepted: false, reason: "not_running" });
    await adapter.stop("done");
    await expect(adapter.deliver({ observationId: "late", kind: "status", payload: null }))
      .rejects.toMatchObject({ code: "ADAPTER_STOPPED" });
  });
});
