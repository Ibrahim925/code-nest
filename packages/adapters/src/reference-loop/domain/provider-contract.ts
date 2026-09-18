import { RuntimeAdapterError, type RuntimeMessage, type RuntimeObservation, type RuntimeToolSummary, type RuntimeTurnBudget, type RuntimeTurnStatus, type RuntimeUsage } from "../../contract.js";
import { parseTurnResult } from "../../validation.js";

export interface ReferenceProviderRequest {
  readonly sessionId: string;
  readonly turnIndex: number;
  readonly runId: string;
  readonly scenarioId: string;
  readonly participantId: string;
  readonly observations: readonly RuntimeObservation[];
  readonly budget: RuntimeTurnBudget;
  readonly signal: AbortSignal;
}

export interface ReferenceModelProvider {
  complete(request: ReferenceProviderRequest): Promise<unknown>;
}

export interface ReferenceProviderResponse {
  readonly messages: readonly RuntimeMessage[];
  readonly commands: readonly unknown[];
  readonly toolSummary: RuntimeToolSummary | null;
  readonly usage: RuntimeUsage;
  readonly status: RuntimeTurnStatus;
  readonly reasoningSummary: string | null;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function protocolError(message: string, cause?: unknown): never {
  throw new RuntimeAdapterError("INVALID_ADAPTER_INPUT", message, cause);
}

export function parseReferenceProviderResponse(
  input: unknown,
  options: { readonly allowReasoningSummary: boolean; readonly wallTimeMilliseconds: number },
): ReferenceProviderResponse {
  const value = record(input);
  if (value === null || !exact(value, [
    "commands", "messages", "reasoningSummary", "status", "toolSummary", "usage",
  ])) return protocolError("Reference provider returned an invalid response shape.");
  const usage = record(value.usage);
  if (
    usage === null || !exact(usage, ["inputTokens", "outputTokens"]) ||
    !Number.isSafeInteger(usage.inputTokens) || Number(usage.inputTokens) < 0 ||
    !Number.isSafeInteger(usage.outputTokens) || Number(usage.outputTokens) < 0 ||
    (value.reasoningSummary !== null && (
      typeof value.reasoningSummary !== "string" || value.reasoningSummary.length === 0 ||
      value.reasoningSummary.length > 4_096 || value.reasoningSummary.includes("\0") ||
      !options.allowReasoningSummary
    ))
  ) return protocolError("Reference provider returned invalid usage or summary metadata.");
  try {
    const turn = parseTurnResult({
      messages: value.messages,
      commands: value.commands,
      commits: [],
      toolSummary: value.toolSummary,
      usage: {
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        wallTimeMilliseconds: options.wallTimeMilliseconds,
      },
      status: value.status,
    });
    return {
      messages: turn.messages,
      commands: turn.commands,
      toolSummary: turn.toolSummary,
      usage: turn.usage as NonNullable<typeof turn.usage>,
      status: turn.status,
      reasoningSummary: value.reasoningSummary as string | null,
    };
  } catch (error: unknown) {
    return protocolError("Reference provider returned an invalid turn.", error);
  }
}
