import {
  FakeRuntimeAdapter,
  ReferenceLoopAdapter,
  type RuntimeAdapter,
  type RuntimeMetadata,
  type TurnResult,
} from "../../packages/adapters/src/index.js";

export interface FixtureWriteCommand {
  readonly kind: "fixture.write";
  readonly path: string;
  readonly contents: string;
}

export interface AdapterSessionResult {
  readonly metadata: RuntimeMetadata;
  readonly sessionId: string;
  readonly turn: TurnResult;
}

function fakeMetadata(): RuntimeMetadata {
  return {
    adapterName: "fake",
    adapterVersion: "1.0.0",
    runtimeName: "contained-fixture-agent",
    runtimeVersion: "1.0.0",
    modelProvider: "fixture-provider",
    modelName: "scripted-contained",
    executionMode: "contained",
    observabilityTier: 1,
    capabilities: [
      "private_message_delivery",
      "typed_tool_events",
      "usage_accounting",
    ],
  };
}

function turn(
  participantId: string,
  round: number,
  command: FixtureWriteCommand | null,
): TurnResult {
  return {
    messages: [{
      messageId: `message-r${round}-${participantId}`,
      channel: "public",
      body: `${participantId} completed round ${round}.`,
      recipientIds: [],
    }],
    commands: command === null ? [] : [command],
    commits: [],
    toolSummary: {
      toolCallCount: command === null ? 1 : 2,
      tools: command === null ? ["review"] : ["edit_file", "review"],
    },
    usage: { inputTokens: 100 + round, outputTokens: 50, wallTimeMilliseconds: 25 },
    status: "completed",
  };
}

function adapter(
  participantId: string,
  round: number,
  mode: "contained" | "split",
  command: FixtureWriteCommand | null,
): RuntimeAdapter {
  const scripted = turn(participantId, round, command);
  if (mode === "contained") {
    return new FakeRuntimeAdapter({
      metadata: fakeMetadata(),
      sessionId: `contained-r${round}-${participantId}`,
      turns: [scripted],
    });
  }
  return new ReferenceLoopAdapter({
    sessionId: `reference-r${round}-${participantId}`,
    providerName: "fixture-provider",
    modelName: "direct-reference",
    providerReasoningSummaries: true,
    now: () => round * 100,
    provider: {
      complete: async () => ({
        messages: scripted.messages,
        commands: scripted.commands,
        toolSummary: scripted.toolSummary,
        usage: {
          inputTokens: scripted.usage?.inputTokens ?? 0,
          outputTokens: scripted.usage?.outputTokens ?? 0,
        },
        status: scripted.status,
        reasoningSummary: `Provider-supplied round ${round} summary.`,
      }),
    },
  });
}

export async function runAdapterSession(input: {
  readonly runId: string;
  readonly scenarioId: string;
  readonly participantId: string;
  readonly workspacePath: string;
  readonly round: number;
  readonly mode: "contained" | "split";
  readonly command: FixtureWriteCommand | null;
}): Promise<AdapterSessionResult> {
  const runtime = adapter(input.participantId, input.round, input.mode, input.command);
  const metadata = await runtime.metadata();
  const sessionId = await runtime.start({
    match: { runId: input.runId, scenarioId: input.scenarioId },
    participant: { participantId: input.participantId },
    workspace: { path: input.workspacePath },
  });
  const accepted = await runtime.deliver({
    observationId: `assignment-r${input.round}-${input.participantId}`,
    kind: "private_message",
    payload: { round: input.round },
  });
  if (!accepted.accepted) throw new Error("Heterogeneous adapter rejected its assignment.");
  const result = await runtime.run({
    maximumOutputTokens: 4_000,
    wallTimeMilliseconds: 60_000,
  });
  await runtime.stop("round_completed");
  return { metadata, sessionId, turn: result };
}
