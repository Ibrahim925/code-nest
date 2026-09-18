import { RuntimeAdapterError, type RuntimeMetadata } from "../../contract.js";
import { parseRuntimeMetadata } from "../../validation.js";
import type { ReferenceModelProvider } from "./provider-contract.js";

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

export interface ReferenceLoopOptions {
  readonly sessionId: string;
  readonly provider: ReferenceModelProvider;
  readonly providerName: string;
  readonly modelName: string;
  readonly providerReasoningSummaries?: boolean;
  readonly now?: () => number;
}

export interface NormalizedReferenceLoopOptions extends ReferenceLoopOptions {
  readonly metadata: RuntimeMetadata;
  readonly providerReasoningSummaries: boolean;
  readonly now: () => number;
}

export function normalizeReferenceLoopOptions(options: ReferenceLoopOptions): NormalizedReferenceLoopOptions {
  if (
    !IDENTIFIER.test(options.sessionId) || typeof options.provider?.complete !== "function" ||
    options.providerName.trim().length === 0 || options.providerName.length > 128 ||
    options.modelName.trim().length === 0 || options.modelName.length > 128
  ) throw new RuntimeAdapterError("INVALID_ADAPTER_INPUT", "Reference loop configuration is invalid.");
  const providerReasoningSummaries = options.providerReasoningSummaries ?? false;
  const metadata = parseRuntimeMetadata({
    adapterName: "reference-loop",
    adapterVersion: "1.0.0",
    runtimeName: "direct-model-loop",
    runtimeVersion: "1.0.0",
    modelProvider: options.providerName,
    modelName: options.modelName,
    executionMode: "split",
    observabilityTier: providerReasoningSummaries ? 2 : 1,
    capabilities: [
      "interrupt",
      "private_message_delivery",
      ...(providerReasoningSummaries ? ["provider_reasoning_summaries" as const] : []),
      "resume",
      "typed_tool_events",
      "usage_accounting",
    ],
  });
  return {
    ...options,
    providerReasoningSummaries,
    metadata,
    now: options.now ?? Date.now,
  };
}
