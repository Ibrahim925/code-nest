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
import type { ProcessLauncher } from "../../subprocess/application/process-session.js";
import {
  parseOmpAssistantText,
  parseOmpState,
  parseOmpUsage,
} from "../domain/rpc.js";
import {
  normalizeOmpConfiguration,
  type NormalizedOmpConfiguration,
  type OmpConfiguration,
} from "../domain/configuration.js";
import { buildOmpPrompt, cloneOmpObservation } from "../domain/prompt.js";
import { OmpRpcSession } from "./omp-rpc-session.js";
import {
  OmpObservabilityBridge,
  type OmpObservabilityOptions,
} from "./omp-observability.js";

type State = "idle" | "starting" | "ready" | "running" | "exited" | "stopped";
const MAX_OBSERVATIONS = 1_000;

export class OmpRuntimeAdapter implements ObservableRuntimeAdapter {
  readonly #options: NormalizedOmpConfiguration;
  readonly #inbox: RuntimeObservation[] = [];
  readonly #observations: RuntimeObservedOutput[] = [];
  #state: State = "idle";
  #rpc: OmpRpcSession | undefined;
  #startRequest: RuntimeStartRequest | undefined;
  #turnCommands: unknown[] = [];
  #turnTools: string[] = [];
  #observationIndex = 0;
  #turnsCompleted = 0;
  #usage: RuntimeUsage = { inputTokens: 0, outputTokens: 0, wallTimeMilliseconds: 0 };
  #finalReport: FinalRuntimeReport | undefined;
  readonly #observability: OmpObservabilityBridge;

  constructor(
    options: OmpConfiguration,
    private readonly launcher: ProcessLauncher,
    observability: OmpObservabilityOptions = {},
  ) {
    this.#options = normalizeOmpConfiguration(options);
    this.#observability = new OmpObservabilityBridge(observability);
  }

  async metadata(): Promise<RuntimeMetadata> {
    return structuredClone(this.#options.metadata);
  }

  async start(request: RuntimeStartRequest): Promise<string> {
    if (this.#state !== "idle") this.#lifecycleError();
    validateRuntimeStartRequest(request);
    this.#state = "starting";
    this.#observability.activity("starting");
    this.#startRequest = structuredClone(request);
    const rpc = new OmpRpcSession(this.#options, this.launcher, {
      diagnostic: () => this.#record("stderr", { text: "OMP emitted a diagnostic line." }),
      tool: (event) => {
        if (this.#state !== "running") return;
        if (event.status === "started") this.#turnTools.push(event.toolName);
        this.#record("tool_call", event);
        this.#observability.tool(event);
      },
      command: (command) => {
        if (this.#state === "running") this.#turnCommands.push(structuredClone(command));
      },
      rationale: (body) => {
        if (this.#state === "running") this.#observability.rationale(body);
      },
      memory: (update) => {
        if (this.#state === "running") this.#observability.memory(update);
      },
    });
    this.#rpc = rpc;
    try {
      await rpc.start(request.workspace.path);
      const state = await rpc.request("get_state");
      parseOmpState(state, {
        provider: this.#options.metadata.modelProvider,
        model: this.#options.metadata.modelName,
      });
      await rpc.configureHostTool();
      this.#state = "ready";
      this.#observability.activity("waiting");
      this.#observability.capture("phase_boundary");
      this.#observability.startHeartbeat();
      await this.#observability.flush();
      return this.#options.sessionId;
    } catch (error: unknown) {
      this.#state = "exited";
      this.#observability.stopHeartbeat();
      this.#observability.activity("failed");
      await rpc.stop();
      await this.#observability.flush().catch(() => undefined);
      throw this.#normalize(error, "OMP failed to start.");
    }
  }

  async deliver(observation: RuntimeObservation): Promise<RuntimeAck> {
    this.#requireReady();
    validateRuntimeObservation(observation);
    if (this.#inbox.length >= MAX_OBSERVATIONS) {
      throw new RuntimeAdapterError("INVALID_ADAPTER_INPUT", "OMP observation limit was exceeded.");
    }
    this.#inbox.push(cloneOmpObservation(observation));
    return { accepted: true, reason: "accepted" };
  }

  async run(budget: RuntimeTurnBudget): Promise<TurnResult> {
    const start = this.#requireReady();
    validateRuntimeBudget(budget);
    const rpc = this.#rpc as OmpRpcSession;
    this.#state = "running";
    this.#observability.activity("working");
    this.#observability.capture("action");
    this.#turnCommands = [];
    this.#turnTools = [];
    const beganAt = Date.now();
    try {
      await this.#observability.flush();
      const before = parseOmpUsage(await rpc.request("get_session_stats"));
      const status = await rpc.prompt(buildOmpPrompt(start, this.#inbox), budget.wallTimeMilliseconds);
      const text = parseOmpAssistantText(await rpc.request("get_last_assistant_text"));
      const after = parseOmpUsage(await rpc.request("get_session_stats"));
      const usage = this.#usageDelta(before, after, Date.now() - beganAt);
      if (usage.outputTokens > budget.maximumOutputTokens) {
        throw new RuntimeAdapterError("INVALID_ADAPTER_INPUT", "OMP exceeded the output-token budget.");
      }
      if (text !== null && text.trim().length > 0) this.#record("work_note", { body: text });
      const result: TurnResult = {
        messages: [],
        commands: structuredClone(this.#turnCommands),
        commits: [],
        toolSummary: this.#turnTools.length === 0 ? null : {
          toolCallCount: this.#turnTools.length,
          tools: [...new Set(this.#turnTools)].sort(),
        },
        usage,
        status,
      };
      this.#turnsCompleted += 1;
      this.#addUsage(usage);
      this.#inbox.length = 0;
      this.#state = "ready";
      if (status !== "interrupted") this.#observability.activity("waiting");
      this.#observability.capture("action");
      await this.#observability.flush();
      return result;
    } catch (error: unknown) {
      this.#state = "exited";
      this.#observability.stopHeartbeat();
      this.#observability.activity("failed");
      await rpc.stop();
      await this.#observability.flush().catch(() => undefined);
      throw this.#normalize(error, "OMP failed to complete a turn.");
    }
  }

  async interrupt(reason: string): Promise<RuntimeAck> {
    validateRuntimeReason(reason);
    if (this.#state !== "running") {
      if (this.#state === "idle") this.#requireReady();
      return { accepted: false, reason: "not_running" };
    }
    const accepted = await this.#rpc?.interrupt() === true;
    if (accepted) {
      this.#observability.activity("paused");
      this.#observability.capture("operator_request");
      await this.#observability.flush();
    }
    return { accepted, reason: accepted ? "accepted" : "not_running" };
  }

  async stop(reason: string): Promise<FinalRuntimeReport> {
    if (this.#finalReport !== undefined) return structuredClone(this.#finalReport);
    if (this.#state === "idle") this.#requireReady();
    if (this.#state === "starting" || this.#state === "running") {
      throw new RuntimeAdapterError("ADAPTER_BUSY", "OMP has an active lifecycle operation.");
    }
    validateRuntimeReason(reason);
    this.#state = "stopped";
    this.#observability.stopHeartbeat();
    this.#observability.activity("stopped");
    this.#observability.capture("phase_boundary");
    let observabilityFailure: unknown;
    try {
      await this.#observability.flush();
    } catch (error: unknown) {
      observabilityFailure = error;
    }
    await this.#rpc?.stop();
    if (observabilityFailure !== undefined) {
      throw this.#normalize(
        observabilityFailure,
        "OMP observability failed during shutdown.",
      );
    }
    this.#finalReport = {
      sessionId: this.#options.sessionId,
      status: "stopped",
      stopReason: reason,
      turnsCompleted: this.#turnsCompleted,
      usage: { ...this.#usage },
    };
    return structuredClone(this.#finalReport);
  }

  observations(): readonly RuntimeObservedOutput[] {
    return structuredClone(this.#observations);
  }

  #record(kind: "stderr" | "tool_call" | "work_note", payload: unknown): void {
    if (this.#observations.length >= MAX_OBSERVATIONS) {
      throw new RuntimeAdapterError("SUBPROCESS_PROTOCOL_ERROR", "OMP observation limit was exceeded.");
    }
    this.#observations.push({
      observationId: `omp-observation-${++this.#observationIndex}`,
      tier: kind === "stderr" ? 0 : 1,
      kind,
      payload: structuredClone(payload),
    });
  }

  #usageDelta(before: RuntimeUsage, after: RuntimeUsage, elapsed: number): RuntimeUsage {
    if (after.inputTokens < before.inputTokens || after.outputTokens < before.outputTokens) {
      throw new RuntimeAdapterError("SUBPROCESS_PROTOCOL_ERROR", "OMP usage counters moved backwards.");
    }
    return {
      inputTokens: after.inputTokens - before.inputTokens,
      outputTokens: after.outputTokens - before.outputTokens,
      wallTimeMilliseconds: Math.max(0, Math.round(elapsed)),
    };
  }

  #addUsage(usage: RuntimeUsage): void {
    this.#usage = {
      inputTokens: this.#usage.inputTokens + usage.inputTokens,
      outputTokens: this.#usage.outputTokens + usage.outputTokens,
      wallTimeMilliseconds: this.#usage.wallTimeMilliseconds + usage.wallTimeMilliseconds,
    };
  }

  #normalize(error: unknown, message: string): RuntimeAdapterError {
    return error instanceof RuntimeAdapterError
      ? error
      : new RuntimeAdapterError("SUBPROCESS_PROTOCOL_ERROR", message, error);
  }

  #requireReady(): RuntimeStartRequest {
    if (this.#state === "idle" || this.#startRequest === undefined) {
      throw new RuntimeAdapterError("ADAPTER_NOT_STARTED", "OMP connector has not started.");
    }
    if (this.#state !== "ready") this.#lifecycleError();
    return this.#startRequest;
  }

  #lifecycleError(): never {
    throw new RuntimeAdapterError(
      this.#state === "starting" || this.#state === "running" ? "ADAPTER_BUSY" : "ADAPTER_STOPPED",
      "OMP lifecycle operation is not allowed in its current state.",
    );
  }
}
