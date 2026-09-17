export const RUNTIME_CAPABILITIES = [
  "interrupt",
  "private_message_delivery",
  "provider_reasoning_summaries",
  "resume",
  "streaming_output",
  "typed_tool_events",
  "usage_accounting",
  "work_notes",
] as const;

export type RuntimeCapability = (typeof RUNTIME_CAPABILITIES)[number];
export type RuntimeExecutionMode = "contained" | "split";
export type ObservabilityTier = 0 | 1 | 2;

export interface RuntimeMetadata {
  readonly adapterName: string;
  readonly adapterVersion: string;
  readonly runtimeName: string;
  readonly runtimeVersion: string;
  readonly modelProvider: string;
  readonly modelName: string;
  readonly executionMode: RuntimeExecutionMode;
  readonly observabilityTier: ObservabilityTier;
  readonly capabilities: readonly RuntimeCapability[];
}

export interface RuntimeCapabilityNegotiation {
  readonly available: readonly RuntimeCapability[];
  readonly unavailable: readonly RuntimeCapability[];
}

export interface RuntimeStartRequest {
  readonly match: {
    readonly runId: string;
    readonly scenarioId: string;
  };
  readonly participant: {
    readonly participantId: string;
  };
  readonly workspace: {
    readonly path: string;
  };
}

export interface RuntimeObservation {
  readonly observationId: string;
  readonly kind: string;
  readonly payload: unknown;
}

export interface RuntimeTurnBudget {
  readonly maximumOutputTokens: number;
  readonly wallTimeMilliseconds: number;
}

export interface RuntimeMessage {
  readonly messageId: string;
  readonly channel: "public" | "private";
  readonly body: string;
  readonly recipientIds: readonly string[];
}

export interface RuntimeCommit {
  readonly revision: string;
  readonly summary: string;
}

export interface RuntimeToolSummary {
  readonly toolCallCount: number;
  readonly tools: readonly string[];
}

export interface RuntimeUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly wallTimeMilliseconds: number;
}

export type RuntimeTurnStatus =
  | "completed"
  | "failed"
  | "interrupted"
  | "waiting"
  | "yielded";

export interface TurnResult {
  readonly messages: readonly RuntimeMessage[];
  readonly commands: readonly unknown[];
  readonly commits: readonly RuntimeCommit[];
  readonly toolSummary: RuntimeToolSummary | null;
  readonly usage: RuntimeUsage | null;
  readonly status: RuntimeTurnStatus;
}

export interface RuntimeAck {
  readonly accepted: boolean;
  readonly reason: "accepted" | "not_running" | "unsupported";
}

export interface FinalRuntimeReport {
  readonly sessionId: string;
  readonly status: "stopped";
  readonly stopReason: string;
  readonly turnsCompleted: number;
  readonly usage: RuntimeUsage | null;
}

export interface RuntimeAdapter {
  metadata(): Promise<RuntimeMetadata>;
  start(request: RuntimeStartRequest): Promise<string>;
  deliver(observation: RuntimeObservation): Promise<RuntimeAck>;
  run(budget: RuntimeTurnBudget): Promise<TurnResult>;
  interrupt(reason: string): Promise<RuntimeAck>;
  stop(reason: string): Promise<FinalRuntimeReport>;
}

export type RuntimeContractErrorCode =
  | "INVALID_CAPABILITY_REQUEST"
  | "INVALID_RUNTIME_METADATA"
  | "INVALID_TURN_RESULT";

export class RuntimeContractError extends Error {
  constructor(
    readonly code: RuntimeContractErrorCode,
    message: string,
    readonly field: string,
  ) {
    super(message);
    this.name = "RuntimeContractError";
  }
}

export type RuntimeAdapterErrorCode =
  | "ADAPTER_ALREADY_STARTED"
  | "ADAPTER_NOT_STARTED"
  | "ADAPTER_STOPPED"
  | "FAKE_SCRIPT_EXHAUSTED"
  | "INVALID_ADAPTER_INPUT"
  | "INVALID_FAKE_SCRIPT"
  | "UNSUPPORTED_OPERATION";

export class RuntimeAdapterError extends Error {
  constructor(
    readonly code: RuntimeAdapterErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "RuntimeAdapterError";
  }
}
