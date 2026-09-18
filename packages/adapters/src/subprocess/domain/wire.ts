import type {
  RuntimeObservation,
  RuntimeStandardObservedOutput,
  RuntimeStartRequest,
  RuntimeTurnBudget,
} from "../../contract.js";

export const SUBPROCESS_WIRE_VERSION = "1.0" as const;

export type SubprocessOperation = "start" | "deliver" | "run" | "stop";

export interface SubprocessRequest {
  readonly wireVersion: typeof SUBPROCESS_WIRE_VERSION;
  readonly requestId: string;
  readonly operation: SubprocessOperation;
  readonly payload:
    | { readonly sessionId: string; readonly request: RuntimeStartRequest }
    | RuntimeObservation
    | RuntimeTurnBudget
    | { readonly reason: string };
}

export type SubprocessFrame =
  | {
      readonly wireVersion: typeof SUBPROCESS_WIRE_VERSION;
      readonly requestId: string;
      readonly type: "response";
      readonly ok: boolean;
      readonly payload: unknown;
    }
  | {
      readonly wireVersion: typeof SUBPROCESS_WIRE_VERSION;
      readonly requestId: string;
      readonly type: "observation";
      readonly payload: Omit<RuntimeStandardObservedOutput, "tier">;
    };

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const OUTPUT_KINDS = new Set([
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
  return actual.length === expected.length && actual.every((key, index) =>
    key === expected[index]
  );
}

export function encodeSubprocessRequest(request: SubprocessRequest): string {
  return `${JSON.stringify(request)}\n`;
}

export function parseSubprocessFrame(line: string): SubprocessFrame {
  let input: unknown;
  try {
    input = JSON.parse(line) as unknown;
  } catch {
    throw new Error("Subprocess emitted malformed JSON.");
  }
  const value = record(input);
  if (
    value === null || !exact(value, ["ok", "payload", "requestId", "type", "wireVersion"]) ||
    value.wireVersion !== SUBPROCESS_WIRE_VERSION ||
    typeof value.requestId !== "string" || !IDENTIFIER.test(value.requestId) ||
    (value.type !== "response" && value.type !== "observation")
  ) throw new Error("Subprocess frame has an invalid envelope.");
  if (value.type === "response") {
    if (typeof value.ok !== "boolean") throw new Error("Subprocess response is invalid.");
    return {
      wireVersion: SUBPROCESS_WIRE_VERSION,
      requestId: value.requestId,
      type: "response",
      ok: value.ok,
      payload: value.payload,
    };
  }
  if (value.ok !== true) throw new Error("Subprocess observation is invalid.");
  const payload = record(value.payload);
  if (
    payload === null || !exact(payload, ["kind", "observationId", "payload"]) ||
    typeof payload.observationId !== "string" || !IDENTIFIER.test(payload.observationId) ||
    typeof payload.kind !== "string" || !OUTPUT_KINDS.has(payload.kind)
  ) throw new Error("Subprocess observation is invalid.");
  return {
    wireVersion: SUBPROCESS_WIRE_VERSION,
    requestId: value.requestId,
    type: "observation",
    ok: true,
    payload: {
      observationId: payload.observationId,
      kind: payload.kind as RuntimeStandardObservedOutput["kind"],
      payload: payload.payload,
    },
  } as SubprocessFrame;
}
