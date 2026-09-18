import { RuntimeAdapterError, type RuntimeUsage } from "../../contract.js";

type OmpStatus = "completed" | "failed" | "interrupted";

export type OmpRpcFrame =
  | { readonly type: "ready" }
  | {
      readonly type: "response";
      readonly id: string;
      readonly command: string;
      readonly success: boolean;
      readonly data: unknown;
    }
  | { readonly type: "agent_end"; readonly terminal: boolean; readonly status: OmpStatus }
  | {
      readonly type: "tool_start";
      readonly toolCallId: string;
      readonly toolName: string;
    }
  | {
      readonly type: "tool_end";
      readonly toolCallId: string;
      readonly toolName: string;
      readonly failed: boolean;
    }
  | {
      readonly type: "host_tool_call";
      readonly id: string;
      readonly toolCallId: string;
      readonly toolName: string;
      readonly arguments: Record<string, unknown>;
    }
  | { readonly type: "ignored" };

export const CODE_NEST_HOST_TOOL = {
  name: "code_nest_submit_command",
  label: "Submit Code Nest command",
  description: "Submit one team message or controller command for validation after this turn.",
  parameters: {
    type: "object",
    additionalProperties: false,
    required: ["command"],
    properties: { command: { type: "object" } },
  },
  loadMode: "always",
} as const;

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function safeId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
}

function protocolError(message: string): never {
  throw new RuntimeAdapterError("SUBPROCESS_PROTOCOL_ERROR", message);
}

function assistantStop(messages: unknown): unknown {
  if (!Array.isArray(messages)) return undefined;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = record(messages[index]);
    if (message?.role === "assistant") return message.stopReason;
  }
  return undefined;
}

function parseAgentEnd(value: Record<string, unknown>): OmpRpcFrame {
  const stop = assistantStop(value.messages);
  return {
    type: "agent_end",
    terminal: value.isTerminal !== false,
    status: stop === "aborted" ? "interrupted" : stop === "error" ? "failed" : "completed",
  };
}

export function encodeOmpCommand(command: Record<string, unknown>): string {
  return `${JSON.stringify(command)}\n`;
}

export function parseOmpFrame(line: string): OmpRpcFrame {
  let input: unknown;
  try { input = JSON.parse(line) as unknown; }
  catch { return protocolError("OMP emitted malformed JSON."); }
  const value = record(input);
  if (value === null || typeof value.type !== "string") {
    return protocolError("OMP emitted an invalid RPC frame.");
  }
  if (value.type === "ready") {
    if (value.protocolVersion !== 1 || !Array.isArray(value.supportedProtocolVersions) ||
      !value.supportedProtocolVersions.includes(1)) {
      return protocolError("OMP RPC version is incompatible.");
    }
    return { type: "ready" };
  }
  if (value.type === "response") {
    if (!safeId(value.id) || typeof value.command !== "string" ||
      value.command.length > 128 || typeof value.success !== "boolean") {
      return protocolError("OMP emitted an invalid RPC response.");
    }
    return {
      type: "response", id: value.id, command: value.command,
      success: value.success, data: value.data,
    };
  }
  if (value.type === "agent_end") return parseAgentEnd(value);
  if (value.type === "tool_execution_start" || value.type === "tool_execution_end") {
    if (!safeId(value.toolCallId) || !safeId(value.toolName)) {
      return protocolError("OMP emitted an invalid tool event.");
    }
    return value.type === "tool_execution_start"
      ? { type: "tool_start", toolCallId: value.toolCallId, toolName: value.toolName }
      : {
          type: "tool_end", toolCallId: value.toolCallId, toolName: value.toolName,
          failed: value.isError === true,
        };
  }
  if (value.type === "host_tool_call") {
    const args = record(value.arguments);
    if (!safeId(value.id) || !safeId(value.toolCallId) || !safeId(value.toolName) || args === null) {
      return protocolError("OMP emitted an invalid host-tool call.");
    }
    return {
      type: "host_tool_call", id: value.id, toolCallId: value.toolCallId,
      toolName: value.toolName, arguments: args,
    };
  }
  return { type: "ignored" };
}

export function parseOmpState(
  input: unknown,
  expected: { readonly provider: string; readonly model: string },
): string {
  const value = record(input);
  const model = record(value?.model);
  if (!safeId(value?.sessionId) || model?.provider !== expected.provider || model.id !== expected.model) {
    return protocolError("OMP started an unexpected model or session.");
  }
  return value.sessionId;
}

function nonnegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

export function parseOmpUsage(input: unknown): RuntimeUsage {
  const value = record(input);
  const tokens = record(value?.tokens);
  if (!nonnegativeInteger(tokens?.input) || !nonnegativeInteger(tokens?.output)) {
    return protocolError("OMP returned invalid usage statistics.");
  }
  return { inputTokens: tokens.input, outputTokens: tokens.output, wallTimeMilliseconds: 0 };
}

export function parseOmpAssistantText(input: unknown): string | null {
  const value = record(input);
  if (value === null || (value.text !== null && typeof value.text !== "string") ||
    (typeof value.text === "string" && (value.text.length > 16_384 || value.text.includes("\0")))) {
    return protocolError("OMP returned an invalid assistant work note.");
  }
  return value.text as string | null;
}

export function parseSubmittedCommand(input: Record<string, unknown>): unknown {
  if (Object.keys(input).length !== 1 || record(input.command) === null) {
    return protocolError("OMP submitted an invalid Code Nest command.");
  }
  try {
    const command = structuredClone(input.command);
    const serialized = JSON.stringify(command);
    if (typeof serialized !== "string" || new TextEncoder().encode(serialized).byteLength > 65_536) {
      return protocolError("OMP submitted an oversized Code Nest command.");
    }
    return command;
  } catch {
    return protocolError("OMP submitted a non-serializable Code Nest command.");
  }
}

export function encodeHostToolResult(id: string, failed = false): string {
  return encodeOmpCommand({
    type: "host_tool_result",
    id,
    result: {
      content: [{
        type: "text",
        text: failed ? "Command submission rejected." : "Command queued for controller validation.",
      }],
    },
    ...(failed ? { isError: true } : {}),
  });
}
