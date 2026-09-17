import {
  RuntimeAdapterError,
  type FinalRuntimeReport,
  type RuntimeAck,
  type RuntimeAdapter,
  type RuntimeCapability,
  type RuntimeMetadata,
  type RuntimeObservation,
  type RuntimeStartRequest,
  type RuntimeTurnBudget,
  type RuntimeUsage,
  type TurnResult,
} from "./contract.js";
import { parseRuntimeMetadata, parseTurnResult } from "./validation.js";

export interface FakeRuntimeAdapterOptions {
  readonly metadata: RuntimeMetadata;
  readonly sessionId: string;
  readonly turns: readonly TurnResult[];
}

export type FakeRuntimeTranscriptEntry =
  | { readonly operation: "start"; readonly value: RuntimeStartRequest }
  | { readonly operation: "deliver"; readonly value: RuntimeObservation }
  | { readonly operation: "run"; readonly value: RuntimeTurnBudget }
  | { readonly operation: "interrupt"; readonly value: string }
  | { readonly operation: "stop"; readonly value: string };

type FakeState = "idle" | "interrupted" | "started" | "stopped";

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export class FakeRuntimeAdapter implements RuntimeAdapter {
  readonly #metadata: RuntimeMetadata;
  readonly #sessionId: string;
  readonly #turns: readonly TurnResult[];
  readonly #transcript: FakeRuntimeTranscriptEntry[] = [];
  #state: FakeState = "idle";
  #turnIndex = 0;
  #completeUsage = true;
  #usage: RuntimeUsage = {
    inputTokens: 0,
    outputTokens: 0,
    wallTimeMilliseconds: 0,
  };
  #finalReport: FinalRuntimeReport | undefined;

  constructor(options: FakeRuntimeAdapterOptions) {
    this.#metadata = parseRuntimeMetadata(options.metadata);
    if (!IDENTIFIER_PATTERN.test(options.sessionId)) {
      throw new RuntimeAdapterError(
        "INVALID_FAKE_SCRIPT",
        "Fake runtime session ID is invalid.",
      );
    }
    this.#sessionId = options.sessionId;
    try {
      this.#turns = options.turns.map((turn) => parseTurnResult(clone(turn)));
    } catch (error: unknown) {
      throw new RuntimeAdapterError(
        "INVALID_FAKE_SCRIPT",
        "Fake runtime contains an invalid scripted turn.",
        error,
      );
    }
    this.#validateScript();
  }

  async metadata(): Promise<RuntimeMetadata> {
    return clone(this.#metadata);
  }

  async start(request: RuntimeStartRequest): Promise<string> {
    if (this.#state === "stopped") this.#stopped();
    if (this.#state !== "idle") {
      throw new RuntimeAdapterError(
        "ADAPTER_ALREADY_STARTED",
        "Runtime adapter has already started.",
      );
    }
    validateStartRequest(request);
    this.#transcript.push({ operation: "start", value: clone(request) });
    this.#state = "started";
    return this.#sessionId;
  }

  async deliver(observation: RuntimeObservation): Promise<RuntimeAck> {
    this.#requireSession();
    validateObservation(observation);
    if (
      observation.kind === "private_message" &&
      !this.#supports("private_message_delivery")
    ) {
      return { accepted: false, reason: "unsupported" };
    }
    this.#transcript.push({ operation: "deliver", value: clone(observation) });
    return { accepted: true, reason: "accepted" };
  }

  async run(budget: RuntimeTurnBudget): Promise<TurnResult> {
    this.#requireSession();
    validateBudget(budget);
    if (this.#state === "interrupted") {
      if (!this.#supports("resume")) {
        throw new RuntimeAdapterError(
          "UNSUPPORTED_OPERATION",
          "Runtime adapter cannot resume after interruption.",
        );
      }
      this.#state = "started";
    }
    const result = this.#turns[this.#turnIndex];
    if (result === undefined) {
      throw new RuntimeAdapterError(
        "FAKE_SCRIPT_EXHAUSTED",
        "Fake runtime has no scripted turn remaining.",
      );
    }
    this.#transcript.push({ operation: "run", value: clone(budget) });
    this.#turnIndex += 1;
    this.#addUsage(result.usage);
    return clone(result);
  }

  async interrupt(reason: string): Promise<RuntimeAck> {
    this.#requireSession();
    if (!this.#supports("interrupt")) {
      return { accepted: false, reason: "unsupported" };
    }
    if (this.#state === "interrupted") {
      return { accepted: false, reason: "not_running" };
    }
    validateReason(reason);
    this.#transcript.push({ operation: "interrupt", value: reason });
    this.#state = "interrupted";
    return { accepted: true, reason: "accepted" };
  }

  async stop(reason: string): Promise<FinalRuntimeReport> {
    if (this.#state === "stopped" && this.#finalReport !== undefined) {
      return clone(this.#finalReport);
    }
    this.#requireSession();
    validateReason(reason);
    this.#transcript.push({ operation: "stop", value: reason });
    this.#state = "stopped";
    this.#finalReport = {
      sessionId: this.#sessionId,
      status: "stopped",
      stopReason: reason,
      turnsCompleted: this.#turnIndex,
      usage: this.#supports("usage_accounting") && this.#completeUsage
        ? clone(this.#usage)
        : null,
    };
    return clone(this.#finalReport);
  }

  transcript(): readonly FakeRuntimeTranscriptEntry[] {
    return clone(this.#transcript);
  }

  #supports(capability: RuntimeCapability): boolean {
    return this.#metadata.capabilities.includes(capability);
  }

  #requireSession(): void {
    if (this.#state === "idle") {
      throw new RuntimeAdapterError(
        "ADAPTER_NOT_STARTED",
        "Runtime adapter has not started.",
      );
    }
    if (this.#state === "stopped") this.#stopped();
  }

  #stopped(): never {
    throw new RuntimeAdapterError(
      "ADAPTER_STOPPED",
      "Runtime adapter has already stopped.",
    );
  }

  #validateScript(): void {
    for (const result of this.#turns) {
      if (
        (!this.#supports("typed_tool_events") &&
          result.toolSummary !== null) ||
        (!this.#supports("usage_accounting") && result.usage !== null) ||
        (!this.#supports("private_message_delivery") &&
          result.messages.some((message) => message.channel === "private"))
      ) {
        throw new RuntimeAdapterError(
          "INVALID_FAKE_SCRIPT",
          "Fake turn exposes observability not declared by metadata.",
        );
      }
    }
  }

  #addUsage(usage: RuntimeUsage | null): void {
    if (usage === null) {
      this.#completeUsage = false;
      return;
    }
    this.#usage = {
      inputTokens: this.#usage.inputTokens + usage.inputTokens,
      outputTokens: this.#usage.outputTokens + usage.outputTokens,
      wallTimeMilliseconds:
        this.#usage.wallTimeMilliseconds + usage.wallTimeMilliseconds,
    };
  }
}

function clone<T>(value: T): T {
  try {
    return structuredClone(value);
  } catch (error: unknown) {
    throw new RuntimeAdapterError(
      "INVALID_FAKE_SCRIPT",
      "Fake runtime data must be structured-cloneable.",
      error,
    );
  }
}

function validateStartRequest(request: RuntimeStartRequest): void {
  if (
    !IDENTIFIER_PATTERN.test(request.match.runId) ||
    !IDENTIFIER_PATTERN.test(request.match.scenarioId) ||
    !IDENTIFIER_PATTERN.test(request.participant.participantId) ||
    request.workspace.path.length === 0
  ) {
    throw new RuntimeAdapterError(
      "INVALID_ADAPTER_INPUT",
      "Runtime start request is invalid.",
    );
  }
}

function validateObservation(observation: RuntimeObservation): void {
  if (
    !IDENTIFIER_PATTERN.test(observation.observationId) ||
    !IDENTIFIER_PATTERN.test(observation.kind)
  ) {
    throw new RuntimeAdapterError(
      "INVALID_ADAPTER_INPUT",
      "Runtime observation is invalid.",
    );
  }
}

function validateBudget(budget: RuntimeTurnBudget): void {
  if (
    !Number.isSafeInteger(budget.maximumOutputTokens) ||
    budget.maximumOutputTokens < 1 ||
    !Number.isSafeInteger(budget.wallTimeMilliseconds) ||
    budget.wallTimeMilliseconds < 1
  ) {
    throw new RuntimeAdapterError(
      "INVALID_ADAPTER_INPUT",
      "Runtime turn budget is invalid.",
    );
  }
}

function validateReason(reason: string): void {
  if (!IDENTIFIER_PATTERN.test(reason)) {
    throw new RuntimeAdapterError(
      "INVALID_ADAPTER_INPUT",
      "Runtime lifecycle reason is invalid.",
    );
  }
}
