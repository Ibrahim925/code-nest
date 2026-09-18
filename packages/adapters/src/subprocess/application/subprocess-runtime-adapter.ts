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
import { parseTurnResult } from "../../validation.js";
import type { ProcessLauncher, ProcessSession } from "./process-session.js";
import {
  encodeSubprocessRequest,
  parseSubprocessFrame,
  type SubprocessOperation,
  type SubprocessRequest,
} from "../domain/wire.js";
import {
  normalizeSubprocessConfiguration,
  parseSubprocessAck,
  validateSubprocessTurn,
  type NormalizedSubprocessConfiguration,
  type SubprocessConfiguration,
} from "../domain/configuration.js";

export type SubprocessRuntimeAdapterOptions = SubprocessConfiguration;

type State = "idle" | "starting" | "running" | "interrupted" | "exited" | "stopped";

interface PendingResponse {
  readonly requestId: string;
  readonly operation: SubprocessOperation;
  readonly resolve: (payload: unknown) => void;
  readonly reject: (error: RuntimeAdapterError) => void;
  readonly timeout: ReturnType<typeof setTimeout>;
}

const MAX_OBSERVATIONS = 1_000;

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

export class SubprocessRuntimeAdapter implements ObservableRuntimeAdapter {
  readonly #metadata: RuntimeMetadata;
  readonly #options: NormalizedSubprocessConfiguration;
  readonly #observations: RuntimeObservedOutput[] = [];
  #session: ProcessSession | undefined;
  #state: State = "idle";
  #requestIndex = 0;
  #stderrIndex = 0;
  #pending: PendingResponse | undefined;
  #turnsCompleted = 0;
  #completeUsage = true;
  #usage: RuntimeUsage = { inputTokens: 0, outputTokens: 0, wallTimeMilliseconds: 0 };
  #finalReport: FinalRuntimeReport | undefined;

  constructor(
    options: SubprocessRuntimeAdapterOptions,
    private readonly launcher: ProcessLauncher,
  ) {
    this.#options = normalizeSubprocessConfiguration(options);
    this.#metadata = this.#options.metadata;
  }

  async metadata(): Promise<RuntimeMetadata> {
    return structuredClone(this.#metadata);
  }

  async start(request: RuntimeStartRequest): Promise<string> {
    if (this.#state !== "idle") this.#lifecycleError();
    validateRuntimeStartRequest(request);
    this.#state = "starting";
    try {
      this.#session = await this.launcher.launch({
        command: this.#options.command,
        args: this.#options.args,
        cwd: request.workspace.path,
        environment: this.#options.environment,
        maximumLineBytes: this.#options.maximumLineBytes,
        onStdoutLine: (line) => this.#receiveLine(line),
        onStderrLine: (line) => this.#recordStderr(line),
        onProtocolError: (error) => this.#failProtocol(error),
      });
      void this.#session.completion.then((exit) => this.#processExited(exit));
    } catch (error: unknown) {
      this.#state = "exited";
      throw new RuntimeAdapterError("SUBPROCESS_START_FAILED", "Coding-agent subprocess failed to start.", error);
    }
    const payload = await this.#request("start", {
      sessionId: this.#options.sessionId,
      request,
    });
    const response = record(payload);
    if (
      response === null || !exact(response, ["sessionId"]) ||
      response.sessionId !== this.#options.sessionId
    ) this.#protocolError("Subprocess returned an invalid session identity.");
    this.#state = "running";
    return this.#options.sessionId;
  }

  async deliver(observation: RuntimeObservation): Promise<RuntimeAck> {
    this.#requireRunning();
    validateRuntimeObservation(observation);
    const payload = await this.#request("deliver", observation);
    return this.#decodeResponse(() => parseSubprocessAck(payload));
  }

  async run(budget: RuntimeTurnBudget): Promise<TurnResult> {
    this.#requireRunning();
    validateRuntimeBudget(budget);
    const payload = await this.#request("run", budget, budget.wallTimeMilliseconds);
    const result = this.#decodeResponse(() => {
      const turn = parseTurnResult(payload);
      validateSubprocessTurn(this.#metadata, turn);
      return turn;
    });
    this.#turnsCompleted += 1;
    this.#addUsage(result.usage);
    return structuredClone(result);
  }

  async interrupt(reason: string): Promise<RuntimeAck> {
    this.#requireRunning();
    if (!this.#metadata.capabilities.includes("interrupt")) {
      return { accepted: false, reason: "unsupported" };
    }
    validateRuntimeReason(reason);
    const accepted = this.#session?.signal("SIGINT") ?? false;
    if (!accepted) return { accepted: false, reason: "not_running" };
    this.#state = "interrupted";
    await this.#finishProcess();
    return { accepted: true, reason: "accepted" };
  }

  async stop(reason: string): Promise<FinalRuntimeReport> {
    if (this.#finalReport !== undefined) return structuredClone(this.#finalReport);
    if (this.#state === "idle") {
      throw new RuntimeAdapterError("ADAPTER_NOT_STARTED", "Runtime adapter has not started.");
    }
    validateRuntimeReason(reason);
    if (this.#state === "running") {
      const payload = await this.#request("stop", { reason });
      this.#decodeResponse(() => parseSubprocessAck(payload));
      await this.#finishProcess("SIGTERM");
    } else if (this.#state === "starting") {
      throw new RuntimeAdapterError("ADAPTER_BUSY", "Runtime adapter is starting.");
    }
    this.#state = "stopped";
    this.#finalReport = {
      sessionId: this.#options.sessionId,
      status: "stopped",
      stopReason: reason,
      turnsCompleted: this.#turnsCompleted,
      usage: this.#metadata.capabilities.includes("usage_accounting") && this.#completeUsage
        ? { ...this.#usage }
        : null,
    };
    return structuredClone(this.#finalReport);
  }

  observations(): readonly RuntimeObservedOutput[] {
    return structuredClone(this.#observations);
  }

  async #request(operation: SubprocessOperation, payload: SubprocessRequest["payload"], timeout?: number) {
    if (this.#pending !== undefined) {
      throw new RuntimeAdapterError("ADAPTER_BUSY", "Runtime adapter already has an active request.");
    }
    const requestId = `request-${++this.#requestIndex}`;
    const response = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending = undefined;
        this.#state = "exited";
        this.#session?.signal("SIGKILL");
        reject(new RuntimeAdapterError("SUBPROCESS_TIMEOUT", "Coding-agent subprocess exceeded its response deadline."));
      }, timeout ?? this.#options.responseTimeoutMilliseconds);
      timer.unref();
      this.#pending = { requestId, operation, resolve, reject, timeout: timer };
    });
    try {
      this.#session?.send(encodeSubprocessRequest({
        wireVersion: "1.0",
        requestId,
        operation,
        payload,
      }));
    } catch (error: unknown) {
      this.#failProtocol(error instanceof Error ? error : new Error("Subprocess input failed."));
    }
    return response;
  }

  #receiveLine(line: string): void {
    try {
      const frame = parseSubprocessFrame(line);
      const pending = this.#pending;
      if (pending === undefined || frame.requestId !== pending.requestId) {
        return this.#protocolError("Subprocess response does not match the active request.");
      }
      if (frame.type === "observation") {
        this.#recordObservation(frame.payload);
        return;
      }
      clearTimeout(pending.timeout);
      this.#pending = undefined;
      if (!frame.ok) {
        pending.reject(new RuntimeAdapterError(
          "SUBPROCESS_PROTOCOL_ERROR",
          `Coding-agent subprocess rejected ${pending.operation}.`,
        ));
      } else pending.resolve(frame.payload);
    } catch (error: unknown) {
      this.#failProtocol(error instanceof Error ? error : new Error("Invalid subprocess output."));
    }
  }

  #decodeResponse<T>(decode: () => T): T {
    try {
      return decode();
    } catch (error: unknown) {
      this.#failProtocol(error instanceof Error ? error : new Error("Invalid response."));
      throw new RuntimeAdapterError(
        "SUBPROCESS_PROTOCOL_ERROR",
        "Coding-agent subprocess returned an invalid response.",
        error,
      );
    }
  }

  #recordObservation(output: Omit<RuntimeObservedOutput, "tier">): void {
    const typed = !["status", "stderr", "stdout"].includes(output.kind);
    if (
      (typed && this.#metadata.observabilityTier < 1) ||
      (output.kind === "work_note" && !this.#metadata.capabilities.includes("work_notes")) ||
      (typed && output.kind !== "work_note" && !this.#metadata.capabilities.includes("typed_tool_events")) ||
      this.#observations.length >= MAX_OBSERVATIONS
    ) return this.#protocolError("Subprocess observation exceeds its declared boundary.");
    this.#observations.push({ ...structuredClone(output), tier: typed ? 1 : 0 });
  }

  #recordStderr(line: string): void {
    this.#recordObservation({
      observationId: `stderr-${++this.#stderrIndex}`,
      kind: "stderr",
      payload: { text: line },
    });
  }

  #failProtocol(error: Error): void {
    const pending = this.#pending;
    if (pending !== undefined) {
      clearTimeout(pending.timeout);
      this.#pending = undefined;
      pending.reject(new RuntimeAdapterError(
        "SUBPROCESS_PROTOCOL_ERROR",
        "Coding-agent subprocess violated its output protocol.",
        error,
      ));
    }
    this.#state = "exited";
    this.#session?.signal("SIGKILL");
  }

  #protocolError(message: string): never {
    const error = new RuntimeAdapterError("SUBPROCESS_PROTOCOL_ERROR", message);
    this.#failProtocol(error);
    throw error;
  }

  #processExited(exit: { code: number | null; signal: string | null }): void {
    const pending = this.#pending;
    if (pending !== undefined) {
      clearTimeout(pending.timeout);
      this.#pending = undefined;
      pending.reject(new RuntimeAdapterError(
        "SUBPROCESS_EXITED",
        "Coding-agent subprocess exited before completing its request.",
        exit,
      ));
    }
    if (this.#state === "running" || this.#state === "starting") this.#state = "exited";
  }

  async #finishProcess(initialSignal?: "SIGTERM"): Promise<void> {
    const session = this.#session;
    if (session === undefined) return;
    if (initialSignal !== undefined) session.signal(initialSignal);
    const completed = await Promise.race([
      session.completion.then(() => true),
      new Promise<false>((resolve) => {
        const timer = setTimeout(() => resolve(false), this.#options.terminationGraceMilliseconds);
        timer.unref();
      }),
    ]);
    if (!completed) {
      session.signal("SIGKILL");
      await session.completion;
    }
  }

  #addUsage(usage: RuntimeUsage | null): void {
    if (usage === null) { this.#completeUsage = false; return; }
    this.#usage = {
      inputTokens: this.#usage.inputTokens + usage.inputTokens,
      outputTokens: this.#usage.outputTokens + usage.outputTokens,
      wallTimeMilliseconds: this.#usage.wallTimeMilliseconds + usage.wallTimeMilliseconds,
    };
  }

  #requireRunning(): void {
    if (this.#state === "idle") throw new RuntimeAdapterError("ADAPTER_NOT_STARTED", "Runtime adapter has not started.");
    if (this.#state !== "running") throw new RuntimeAdapterError("ADAPTER_STOPPED", "Runtime adapter is not running.");
  }

  #lifecycleError(): never {
    throw new RuntimeAdapterError(
      this.#state === "stopped" || this.#state === "exited" ? "ADAPTER_STOPPED" : "ADAPTER_ALREADY_STARTED",
      "Runtime adapter cannot start in its current state.",
    );
  }
}
