import {
  RUNTIME_CAPABILITIES,
  RuntimeContractError,
  type RuntimeCapability,
  type RuntimeCapabilityNegotiation,
  type RuntimeCommit,
  type RuntimeMessage,
  type RuntimeMetadata,
  type RuntimeToolSummary,
  type RuntimeTurnStatus,
  type RuntimeUsage,
  type TurnResult,
} from "./contract.js";

const METADATA_KEYS = [
  "adapterName",
  "adapterVersion",
  "capabilities",
  "executionMode",
  "modelName",
  "modelProvider",
  "observabilityTier",
  "runtimeName",
  "runtimeVersion",
] as const;
const TURN_RESULT_KEYS = [
  "commands",
  "commits",
  "messages",
  "status",
  "toolSummary",
  "usage",
] as const;
const CAPABILITY_SET = new Set<string>(RUNTIME_CAPABILITIES);
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const REVISION_PATTERN = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const TURN_STATUSES = new Set<string>([
  "completed",
  "failed",
  "interrupted",
  "waiting",
  "yielded",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  );
}

function invalidMetadata(field: string): never {
  throw new RuntimeContractError(
    "INVALID_RUNTIME_METADATA",
    `Runtime metadata field ${field} is invalid.`,
    field,
  );
}

function metadataString(value: unknown, field: string): string {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.length > 128
  ) {
    return invalidMetadata(field);
  }
  return value;
}

function metadataCapabilities(value: unknown): RuntimeCapability[] {
  if (
    !Array.isArray(value) ||
    value.length > RUNTIME_CAPABILITIES.length ||
    value.some((item) => typeof item !== "string" || !CAPABILITY_SET.has(item))
  ) {
    return invalidMetadata("/capabilities");
  }
  if (new Set(value).size !== value.length) {
    return invalidMetadata("/capabilities");
  }
  return value as RuntimeCapability[];
}

function invalidTurn(field: string): never {
  throw new RuntimeContractError(
    "INVALID_TURN_RESULT",
    `Runtime turn result field ${field} is invalid.`,
    field,
  );
}

function nonnegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && typeof value === "number" && value >= 0;
}

function parseMessages(value: unknown): RuntimeMessage[] {
  if (!Array.isArray(value) || value.length > 1_000) {
    return invalidTurn("/messages");
  }
  return value.map((item, index) => {
    const field = `/messages/${index}`;
    if (
      !isRecord(item) ||
      !hasExactKeys(item, [
        "body",
        "channel",
        "messageId",
        "recipientIds",
      ]) ||
      typeof item.messageId !== "string" ||
      !IDENTIFIER_PATTERN.test(item.messageId) ||
      (item.channel !== "public" && item.channel !== "private") ||
      typeof item.body !== "string" ||
      item.body.length > 65_536 ||
      !Array.isArray(item.recipientIds) ||
      item.recipientIds.length > 64 ||
      item.recipientIds.some(
        (recipient) =>
          typeof recipient !== "string" ||
          !IDENTIFIER_PATTERN.test(recipient),
      ) ||
      new Set(item.recipientIds).size !== item.recipientIds.length ||
      (item.channel === "public" && item.recipientIds.length !== 0) ||
      (item.channel === "private" && item.recipientIds.length === 0)
    ) {
      return invalidTurn(field);
    }
    return {
      messageId: item.messageId,
      channel: item.channel,
      body: item.body,
      recipientIds: [...item.recipientIds] as string[],
    };
  });
}

function parseCommits(value: unknown): RuntimeCommit[] {
  if (!Array.isArray(value) || value.length > 256) {
    return invalidTurn("/commits");
  }
  return value.map((item, index) => {
    const field = `/commits/${index}`;
    if (
      !isRecord(item) ||
      !hasExactKeys(item, ["revision", "summary"]) ||
      typeof item.revision !== "string" ||
      !REVISION_PATTERN.test(item.revision) ||
      typeof item.summary !== "string" ||
      item.summary.length < 1 ||
      item.summary.length > 1_024
    ) {
      return invalidTurn(field);
    }
    return { revision: item.revision, summary: item.summary };
  });
}

function parseToolSummary(value: unknown): RuntimeToolSummary | null {
  if (value === null) return null;
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["toolCallCount", "tools"]) ||
    !nonnegativeInteger(value.toolCallCount) ||
    !Array.isArray(value.tools) ||
    value.tools.length > 256 ||
    value.tools.some(
      (tool) =>
        typeof tool !== "string" ||
        tool.length < 1 ||
        tool.length > 128,
    )
  ) {
    return invalidTurn("/toolSummary");
  }
  return {
    toolCallCount: value.toolCallCount,
    tools: [...value.tools] as string[],
  };
}

function parseUsage(value: unknown): RuntimeUsage | null {
  if (value === null) return null;
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "inputTokens",
      "outputTokens",
      "wallTimeMilliseconds",
    ]) ||
    !nonnegativeInteger(value.inputTokens) ||
    !nonnegativeInteger(value.outputTokens) ||
    !nonnegativeInteger(value.wallTimeMilliseconds)
  ) {
    return invalidTurn("/usage");
  }
  return {
    inputTokens: value.inputTokens,
    outputTokens: value.outputTokens,
    wallTimeMilliseconds: value.wallTimeMilliseconds,
  };
}

export function parseRuntimeMetadata(input: unknown): RuntimeMetadata {
  if (!isRecord(input) || !hasExactKeys(input, METADATA_KEYS)) {
    return invalidMetadata("/");
  }
  const executionMode = input.executionMode;
  if (executionMode !== "contained" && executionMode !== "split") {
    return invalidMetadata("/executionMode");
  }
  const observabilityTier = input.observabilityTier;
  if (
    observabilityTier !== 0 &&
    observabilityTier !== 1 &&
    observabilityTier !== 2
  ) {
    return invalidMetadata("/observabilityTier");
  }
  const capabilities = metadataCapabilities(input.capabilities);
  if (
    (capabilities.includes("typed_tool_events") && observabilityTier < 1) ||
    (capabilities.includes("work_notes") && observabilityTier < 1) ||
    (capabilities.includes("provider_reasoning_summaries") &&
      observabilityTier < 2)
  ) {
    return invalidMetadata("/capabilities");
  }

  return {
    adapterName: metadataString(input.adapterName, "/adapterName"),
    adapterVersion: metadataString(input.adapterVersion, "/adapterVersion"),
    runtimeName: metadataString(input.runtimeName, "/runtimeName"),
    runtimeVersion: metadataString(input.runtimeVersion, "/runtimeVersion"),
    modelProvider: metadataString(input.modelProvider, "/modelProvider"),
    modelName: metadataString(input.modelName, "/modelName"),
    executionMode,
    observabilityTier,
    capabilities: [...capabilities],
  };
}

export function negotiateRuntimeCapabilities(
  metadata: RuntimeMetadata,
  requested: readonly RuntimeCapability[],
): RuntimeCapabilityNegotiation {
  const parsed = parseRuntimeMetadata(metadata);
  if (
    requested.some((capability) => !CAPABILITY_SET.has(capability)) ||
    new Set(requested).size !== requested.length
  ) {
    throw new RuntimeContractError(
      "INVALID_CAPABILITY_REQUEST",
      "Requested runtime capabilities must be known and unique.",
      "/capabilities",
    );
  }

  const declared = new Set(parsed.capabilities);
  return {
    available: requested.filter((capability) => declared.has(capability)),
    unavailable: requested.filter((capability) => !declared.has(capability)),
  };
}

export function parseTurnResult(input: unknown): TurnResult {
  if (!isRecord(input) || !hasExactKeys(input, TURN_RESULT_KEYS)) {
    return invalidTurn("/");
  }
  if (!Array.isArray(input.commands) || input.commands.length > 1_000) {
    return invalidTurn("/commands");
  }
  if (typeof input.status !== "string" || !TURN_STATUSES.has(input.status)) {
    return invalidTurn("/status");
  }

  return {
    messages: parseMessages(input.messages),
    commands: [...input.commands],
    commits: parseCommits(input.commits),
    toolSummary: parseToolSummary(input.toolSummary),
    usage: parseUsage(input.usage),
    status: input.status as RuntimeTurnStatus,
  };
}
