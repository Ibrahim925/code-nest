import {
  RuntimeAdapterError,
  type RuntimeMetadata,
} from "../../contract.js";

export type OmpThinkingLevel = "low" | "medium" | "high" | "xhigh" | "max";

export interface OmpConfiguration {
  readonly sessionId: string;
  readonly runtimeVersion: string;
  readonly modelProvider: string;
  readonly modelName: string;
  readonly modelSelector: string;
  readonly command?: string;
  readonly commandArgs?: readonly string[];
  readonly environment?: Readonly<Record<string, string>>;
  readonly thinkingLevel?: OmpThinkingLevel;
  readonly maximumLineBytes?: number;
  readonly startupTimeoutMilliseconds?: number;
  readonly responseTimeoutMilliseconds?: number;
  readonly terminationGraceMilliseconds?: number;
}

export interface NormalizedOmpConfiguration {
  readonly metadata: RuntimeMetadata;
  readonly sessionId: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly environment: Readonly<Record<string, string>>;
  readonly maximumLineBytes: number;
  readonly startupTimeoutMilliseconds: number;
  readonly responseTimeoutMilliseconds: number;
  readonly terminationGraceMilliseconds: number;
}

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
const ENVIRONMENT_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const THINKING_LEVELS = new Set<OmpThinkingLevel>([
  "low", "medium", "high", "xhigh", "max",
]);
const OMP_TOOLS = "read,bash,edit,write,grep,glob";

function invalid(): never {
  throw new RuntimeAdapterError(
    "INVALID_ADAPTER_INPUT",
    "OMP connector configuration is invalid.",
  );
}

function boundedInteger(value: number, minimum: number, maximum: number): boolean {
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

function invalidText(value: string, maximum = 4_096): boolean {
  return value.length === 0 || value.length > maximum || value.includes("\0");
}

export function normalizeOmpConfiguration(
  input: OmpConfiguration,
): NormalizedOmpConfiguration {
  const command = input.command ?? "omp";
  const commandArgs = [...(input.commandArgs ?? [])];
  const environment = { ...(input.environment ?? {}) };
  const thinking = input.thinkingLevel ?? "medium";
  const maximumLineBytes = input.maximumLineBytes ?? 1_048_576;
  const startupTimeoutMilliseconds = input.startupTimeoutMilliseconds ?? 15_000;
  const responseTimeoutMilliseconds = input.responseTimeoutMilliseconds ?? 5_000;
  const terminationGraceMilliseconds = input.terminationGraceMilliseconds ?? 1_000;
  if (
    !IDENTIFIER.test(input.sessionId) || invalidText(input.runtimeVersion, 128) ||
    !IDENTIFIER.test(input.modelProvider) || !IDENTIFIER.test(input.modelName) ||
    !IDENTIFIER.test(input.modelSelector) || invalidText(command) ||
    commandArgs.length > 32 || commandArgs.some((item) => invalidText(item)) ||
    Object.entries(environment).some(([name, value]) =>
      !ENVIRONMENT_NAME.test(name) || value.length > 8_192 || value.includes("\0")
    ) || !THINKING_LEVELS.has(thinking) ||
    !boundedInteger(maximumLineBytes, 256, 1_048_576) ||
    !boundedInteger(startupTimeoutMilliseconds, 1, 60_000) ||
    !boundedInteger(responseTimeoutMilliseconds, 1, 60_000) ||
    !boundedInteger(terminationGraceMilliseconds, 1, 10_000)
  ) invalid();
  return {
    metadata: {
      adapterName: "omp-rpc",
      adapterVersion: "1.0.0",
      runtimeName: "omp",
      runtimeVersion: input.runtimeVersion,
      modelProvider: input.modelProvider,
      modelName: input.modelName,
      executionMode: "contained",
      observabilityTier: 1,
      capabilities: [
        "computer_frames", "interrupt", "resume", "streaming_output",
        "submitted_rationales", "typed_tool_events", "usage_accounting",
        "work_notes", "working_memory",
      ],
    },
    sessionId: input.sessionId,
    command,
    args: [
      ...commandArgs,
      "--mode", "rpc",
      "--model", input.modelSelector,
      "--thinking", thinking,
      "--no-session",
      "--no-extensions",
      "--no-skills",
      "--no-title",
      "--no-pty",
      "--tools", OMP_TOOLS,
      "--approval-mode", "yolo",
    ],
    environment,
    maximumLineBytes,
    startupTimeoutMilliseconds,
    responseTimeoutMilliseconds,
    terminationGraceMilliseconds,
  };
}
