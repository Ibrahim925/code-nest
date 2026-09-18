import {
  RuntimeContractError,
  type RuntimeObservedOutput,
  type RuntimeStandardOutputKind,
  type RuntimeUsage,
} from "./contract.js";

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const STANDARD_KINDS = new Set<string>([
  "command", "file_changed", "message", "status", "stderr", "stdout",
  "test_completed", "tool_call", "work_note",
]);

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every(
    (key, index) => key === expected[index],
  );
}

function invalid(field: string): never {
  throw new RuntimeContractError(
    "INVALID_RUNTIME_OBSERVATION",
    `Runtime observation field ${field} is invalid.`,
    field,
  );
}

function positiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function parseUsage(value: unknown): RuntimeUsage {
  const input = record(value);
  const keys = ["inputTokens", "outputTokens", "wallTimeMilliseconds"];
  if (
    input === null || !exact(input, keys) ||
    !keys.every((key) => typeof input[key] === "number" &&
      Number.isSafeInteger(input[key]) && (input[key] as number) >= 0)
  ) invalid("/payload/usage");
  return {
    inputTokens: input.inputTokens as number,
    outputTokens: input.outputTokens as number,
    wallTimeMilliseconds: input.wallTimeMilliseconds as number,
  };
}

export function parseRuntimeObservedOutput(input: unknown): RuntimeObservedOutput {
  const value = record(input);
  if (
    value === null || typeof value.observationId !== "string" ||
    !IDENTIFIER.test(value.observationId)
  ) invalid("/observationId");

  if (value.tier === 0 || value.tier === 1) {
    if (
      !exact(value, ["kind", "observationId", "payload", "tier"]) ||
      typeof value.kind !== "string" || !STANDARD_KINDS.has(value.kind)
    ) invalid("/kind");
    return {
      observationId: value.observationId,
      tier: value.tier,
      kind: value.kind as RuntimeStandardOutputKind,
      payload: structuredClone(value.payload),
    };
  }

  if (
    value.tier !== 2 ||
    !exact(value, ["kind", "observationId", "payload", "provenance", "tier"])
  ) invalid("/tier");
  const payload = record(value.payload);
  if (payload === null || !positiveInteger(payload.turnIndex)) {
    invalid("/payload/turnIndex");
  }
  if (value.kind === "provider_reasoning_summary") {
    if (
      value.provenance !== "provider_supplied" ||
      !exact(payload, ["text", "turnIndex"]) ||
      typeof payload.text !== "string" || payload.text.length < 1 ||
      payload.text.length > 4_096
    ) invalid("/provenance");
    return {
      observationId: value.observationId,
      tier: 2,
      kind: value.kind,
      provenance: value.provenance,
      payload: { turnIndex: payload.turnIndex, text: payload.text },
    };
  }
  if (
    value.kind !== "provider_usage" || value.provenance !== "provider_reported" ||
    !exact(payload, ["turnIndex", "usage"])
  ) invalid("/kind");
  return {
    observationId: value.observationId,
    tier: 2,
    kind: value.kind,
    provenance: value.provenance,
    payload: { turnIndex: payload.turnIndex, usage: parseUsage(payload.usage) },
  };
}
