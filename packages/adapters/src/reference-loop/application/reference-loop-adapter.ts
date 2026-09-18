import {
  RuntimeAdapterError,
  type FinalRuntimeReport,
  type ObservableRuntimeAdapter,
  type RuntimeAck,
  type RuntimeMetadata,
  type RuntimeObservation,
  type RuntimeObservedOutput,
  type RuntimeStartRequest,
  type RuntimeTurnBudget,
  type RuntimeUsage,
  type TurnResult,
} from "../../contract.js";
import {
  validateRuntimeBudget,
  validateRuntimeObservation,
  validateRuntimeReason,
  validateRuntimeStartRequest,
} from "../../input-validation.js";
import { normalizeReferenceLoopOptions, type NormalizedReferenceLoopOptions, type ReferenceLoopOptions } from "../domain/configuration.js";
import { parseReferenceProviderResponse } from "../domain/provider-contract.js";

type State = "idle" | "ready" | "stopped";

export type ReferenceNativeObservation =
  | {
    readonly observationId: string;
    readonly kind: "provider_usage";
    readonly provenance: "provider_reported";
    readonly turnIndex: number;
    readonly usage: RuntimeUsage;
  }
  | {
    readonly observationId: string;
    readonly kind: "provider_reasoning_summary";
    readonly provenance: "provider_supplied";
    readonly turnIndex: number;
    readonly text: string;
  };

const MAX_OBSERVATIONS = 1_000;

export class ReferenceLoopAdapter implements ObservableRuntimeAdapter {
  readonly #options: NormalizedReferenceLoopOptions;
  readonly #inbox: RuntimeObservation[] = [];
  readonly #observed: RuntimeObservedOutput[] = [];
  readonly #native: ReferenceNativeObservation[] = [];
  #state: State = "idle";
  #startRequest: RuntimeStartRequest | undefined;
  #activeAbort: AbortController | undefined;
  #turnsCompleted = 0;
  #completeUsage = true;
  #usage: RuntimeUsage = { inputTokens: 0, outputTokens: 0, wallTimeMilliseconds: 0 };
  #finalReport: FinalRuntimeReport | undefined;

  constructor(options: ReferenceLoopOptions) {
    this.#options = normalizeReferenceLoopOptions(options);
  }

  async metadata(): Promise<RuntimeMetadata> { return structuredClone(this.#options.metadata); }

  async start(request: RuntimeStartRequest): Promise<string> {
    if (this.#state !== "idle") this.#lifecycleError();
    validateRuntimeStartRequest(request);
    this.#startRequest = structuredClone(request);
    this.#state = "ready";
    return this.#options.sessionId;
  }

  async deliver(observation: RuntimeObservation): Promise<RuntimeAck> {
    this.#requireReady();
    if (this.#activeAbort !== undefined) throw new RuntimeAdapterError("ADAPTER_BUSY", "Reference loop is completing a turn.");
    validateRuntimeObservation(observation);
    if (this.#inbox.length >= MAX_OBSERVATIONS) {
      throw new RuntimeAdapterError("INVALID_ADAPTER_INPUT", "Reference loop observation limit was exceeded.");
    }
    try { this.#inbox.push(structuredClone(observation)); }
    catch (error: unknown) { throw new RuntimeAdapterError("INVALID_ADAPTER_INPUT", "Reference observation is not cloneable.", error); }
    return { accepted: true, reason: "accepted" };
  }

  async run(budget: RuntimeTurnBudget): Promise<TurnResult> {
    const start = this.#requireReady();
    if (this.#activeAbort !== undefined) throw new RuntimeAdapterError("ADAPTER_BUSY", "Reference loop already has an active turn.");
    validateRuntimeBudget(budget);
    const abort = new AbortController();
    this.#activeAbort = abort;
    const beganAt = this.#options.now();
    const timeout = setTimeout(() => abort.abort("turn_timeout"), budget.wallTimeMilliseconds);
    timeout.unref();
    try {
      const providerRequest = {
        sessionId: this.#options.sessionId,
        turnIndex: this.#turnsCompleted + 1,
        runId: start.match.runId,
        scenarioId: start.match.scenarioId,
        participantId: start.participant.participantId,
        observations: structuredClone(this.#inbox),
        budget: { ...budget },
        signal: abort.signal,
      } as const;
      const raw = await Promise.race([
        this.#options.provider.complete(providerRequest),
        new Promise<never>((_, reject) => {
          abort.signal.addEventListener("abort", () => reject(new Error("Reference turn aborted.")), { once: true });
        }),
      ]);
      if (abort.signal.aborted) return this.#interruptedTurn();
      const elapsed = Math.max(0, Math.round(this.#options.now() - beganAt));
      const response = parseReferenceProviderResponse(raw, {
        allowReasoningSummary: this.#options.providerReasoningSummaries,
        wallTimeMilliseconds: elapsed,
      });
      if (response.usage.outputTokens > budget.maximumOutputTokens) {
        throw new RuntimeAdapterError("INVALID_ADAPTER_INPUT", "Reference provider exceeded the output-token budget.");
      }
      const turn: TurnResult = {
        messages: response.messages,
        commands: response.commands,
        commits: [],
        toolSummary: response.toolSummary,
        usage: response.usage,
        status: response.status,
      };
      let safeTurn: TurnResult;
      try { safeTurn = structuredClone(turn); }
      catch (error: unknown) {
        throw new RuntimeAdapterError("INVALID_ADAPTER_INPUT", "Reference provider returned non-cloneable output.", error);
      }
      const turnIndex = this.#turnsCompleted + 1;
      this.#recordTurn(safeTurn, turnIndex, response.reasoningSummary);
      this.#turnsCompleted = turnIndex;
      this.#inbox.length = 0;
      this.#addUsage(response.usage);
      return safeTurn;
    } catch (error: unknown) {
      if (abort.signal.aborted && abort.signal.reason === "turn_timeout") {
        throw new RuntimeAdapterError("INVALID_ADAPTER_INPUT", "Reference provider exceeded the turn deadline.", error);
      }
      if (abort.signal.aborted) return this.#interruptedTurn();
      if (error instanceof RuntimeAdapterError) throw error;
      throw new RuntimeAdapterError("INVALID_ADAPTER_INPUT", "Reference provider failed to complete a turn.", error);
    } finally {
      clearTimeout(timeout);
      this.#activeAbort = undefined;
    }
  }

  async interrupt(reason: string): Promise<RuntimeAck> {
    this.#requireReady();
    validateRuntimeReason(reason);
    if (this.#activeAbort === undefined) return { accepted: false, reason: "not_running" };
    this.#activeAbort.abort(reason);
    return { accepted: true, reason: "accepted" };
  }

  async stop(reason: string): Promise<FinalRuntimeReport> {
    if (this.#finalReport !== undefined) return structuredClone(this.#finalReport);
    this.#requireReady();
    if (this.#activeAbort !== undefined) throw new RuntimeAdapterError("ADAPTER_BUSY", "Interrupt the active turn before stopping.");
    validateRuntimeReason(reason);
    this.#state = "stopped";
    this.#finalReport = {
      sessionId: this.#options.sessionId,
      status: "stopped",
      stopReason: reason,
      turnsCompleted: this.#turnsCompleted,
      usage: this.#completeUsage ? { ...this.#usage } : null,
    };
    return structuredClone(this.#finalReport);
  }

  observations(): readonly RuntimeObservedOutput[] { return structuredClone(this.#observed); }
  nativeObservations(): readonly ReferenceNativeObservation[] { return structuredClone(this.#native); }

  #recordTurn(turn: TurnResult, turnIndex: number, summary: string | null): void {
    const observedCount = turn.commands.length + turn.messages.length + 1;
    const nativeCount = (turn.usage === null ? 0 : 1) + (summary === null ? 0 : 1);
    if (this.#observed.length + observedCount > MAX_OBSERVATIONS || this.#native.length + nativeCount > MAX_OBSERVATIONS) {
      throw new RuntimeAdapterError("INVALID_ADAPTER_INPUT", "Reference provider exceeded the observation boundary.");
    }
    for (const [index, command] of turn.commands.entries()) {
      this.#observed.push({ observationId: `turn-${turnIndex}-command-${index + 1}`, tier: 1, kind: "command", payload: command });
    }
    for (const [index, message] of turn.messages.entries()) {
      this.#observed.push({ observationId: `turn-${turnIndex}-message-${index + 1}`, tier: 1, kind: "message", payload: message });
    }
    this.#observed.push({
      observationId: `turn-${turnIndex}-status`, tier: 0, kind: "status", payload: { status: turn.status },
    });
    if (turn.usage !== null) this.#native.push({
      observationId: `turn-${turnIndex}-usage`, kind: "provider_usage", provenance: "provider_reported",
      turnIndex, usage: { ...turn.usage },
    });
    if (summary !== null) this.#native.push({
      observationId: `turn-${turnIndex}-summary`, kind: "provider_reasoning_summary",
      provenance: "provider_supplied", turnIndex, text: summary,
    });
  }

  #interruptedTurn(): TurnResult {
    this.#completeUsage = false;
    return { messages: [], commands: [], commits: [], toolSummary: null, usage: null, status: "interrupted" };
  }

  #addUsage(usage: RuntimeUsage): void {
    this.#usage = {
      inputTokens: this.#usage.inputTokens + usage.inputTokens,
      outputTokens: this.#usage.outputTokens + usage.outputTokens,
      wallTimeMilliseconds: this.#usage.wallTimeMilliseconds + usage.wallTimeMilliseconds,
    };
  }

  #requireReady(): RuntimeStartRequest {
    if (this.#state === "idle" || this.#startRequest === undefined) {
      throw new RuntimeAdapterError("ADAPTER_NOT_STARTED", "Reference loop has not started.");
    }
    if (this.#state === "stopped") this.#lifecycleError();
    return this.#startRequest;
  }

  #lifecycleError(): never {
    throw new RuntimeAdapterError(
      this.#state === "stopped" ? "ADAPTER_STOPPED" : "ADAPTER_ALREADY_STARTED",
      "Reference loop lifecycle operation is not allowed in its current state.",
    );
  }
}
