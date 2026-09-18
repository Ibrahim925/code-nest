import {
  RuntimeAdapterError,
  type RuntimeAck,
  type RuntimeMetadata,
  type TurnResult,
} from "../../contract.js";
import { parseRuntimeMetadata } from "../../validation.js";

export interface SubprocessConfiguration {
  readonly metadata: RuntimeMetadata;
  readonly sessionId: string;
  readonly command: string;
  readonly args?: readonly string[];
  readonly environment?: Readonly<Record<string, string>>;
  readonly maximumLineBytes?: number;
  readonly responseTimeoutMilliseconds?: number;
  readonly terminationGraceMilliseconds?: number;
}

export interface NormalizedSubprocessConfiguration {
  readonly metadata: RuntimeMetadata;
  readonly sessionId: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly environment: Readonly<Record<string, string>>;
  readonly maximumLineBytes: number;
  readonly responseTimeoutMilliseconds: number;
  readonly terminationGraceMilliseconds: number;
}

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const ENVIRONMENT_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) =>
    key === expected[index]
  );
}

export function normalizeSubprocessConfiguration(
  options: SubprocessConfiguration,
): NormalizedSubprocessConfiguration {
  const lineBytes = options.maximumLineBytes ?? 65_536;
  const timeout = options.responseTimeoutMilliseconds ?? 5_000;
  const grace = options.terminationGraceMilliseconds ?? 1_000;
  if (
    !IDENTIFIER.test(options.sessionId) || options.command.length === 0 ||
    options.command.includes("\0") || (options.args?.length ?? 0) > 64 ||
    options.args?.some((argument) => argument.length > 4_096 || argument.includes("\0")) === true ||
    Object.entries(options.environment ?? {}).some(([name, value]) =>
      !ENVIRONMENT_NAME.test(name) || value.length > 4_096 || value.includes("\0")
    ) || !Number.isSafeInteger(lineBytes) || lineBytes < 256 || lineBytes > 1_048_576 ||
    !Number.isSafeInteger(timeout) || timeout < 1 || timeout > 60_000 ||
    !Number.isSafeInteger(grace) || grace < 1 || grace > 10_000
  ) throw new RuntimeAdapterError("INVALID_ADAPTER_INPUT", "Subprocess configuration is invalid.");
  const metadata = parseRuntimeMetadata(options.metadata);
  if (
    metadata.observabilityTier > 1 ||
    metadata.capabilities.includes("provider_reasoning_summaries") ||
    metadata.capabilities.includes("resume") ||
    !metadata.capabilities.includes("streaming_output")
  ) throw new RuntimeAdapterError(
    "INVALID_ADAPTER_INPUT",
    "Subprocess adapters support Tier 0/1 streaming without resume or provider reasoning summaries.",
  );
  return {
    metadata,
    sessionId: options.sessionId,
    command: options.command,
    args: [...(options.args ?? [])],
    environment: { ...(options.environment ?? {}) },
    maximumLineBytes: lineBytes,
    responseTimeoutMilliseconds: timeout,
    terminationGraceMilliseconds: grace,
  };
}

export function parseSubprocessAck(payload: unknown): RuntimeAck {
  const value = record(payload);
  if (
    value === null || !exact(value, ["accepted", "reason"]) ||
    typeof value.accepted !== "boolean" ||
    (value.reason !== "accepted" && value.reason !== "not_running" && value.reason !== "unsupported")
  ) throw new RuntimeAdapterError("SUBPROCESS_PROTOCOL_ERROR", "Subprocess returned an invalid acknowledgement.");
  return { accepted: value.accepted, reason: value.reason };
}

export function validateSubprocessTurn(
  metadata: RuntimeMetadata,
  result: TurnResult,
): void {
  if (
    (result.toolSummary !== null && !metadata.capabilities.includes("typed_tool_events")) ||
    (result.usage !== null && !metadata.capabilities.includes("usage_accounting")) ||
    (result.messages.some(({ channel }) => channel === "private") &&
      !metadata.capabilities.includes("private_message_delivery"))
  ) throw new RuntimeAdapterError(
    "SUBPROCESS_PROTOCOL_ERROR",
    "Subprocess result exceeds its declared capabilities.",
  );
}
