import { RuntimeAdapterError } from "../../contract.js";
import type { ProcessLauncher, ProcessSession } from "../../subprocess/application/process-session.js";
import {
  CODE_NEST_HOST_TOOL,
  CODE_NEST_HOST_TOOLS,
  CODE_NEST_MEMORY_TOOL,
  CODE_NEST_RATIONALE_TOOL,
  encodeHostToolResult,
  encodeOmpCommand,
  parseOmpFrame,
  parseSubmittedMemory,
  parseSubmittedCommand,
  parseSubmittedRationale,
} from "../domain/rpc.js";
import type { NormalizedOmpConfiguration } from "../domain/configuration.js";

export type OmpTurnStatus = "completed" | "failed" | "interrupted";

export interface OmpRpcSessionEvents {
  readonly diagnostic: () => void;
  readonly tool: (event: {
    readonly toolCallId: string;
    readonly toolName: string;
    readonly status: "started" | "completed" | "failed";
  }) => void;
  readonly command: (command: unknown) => void;
  readonly rationale: (body: string) => void;
  readonly memory: (update: ReturnType<typeof parseSubmittedMemory>) => void;
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (error: RuntimeAdapterError) => void;
}

interface Pending extends Deferred<unknown> {
  readonly command: string;
  readonly timeout: ReturnType<typeof setTimeout>;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: RuntimeAdapterError) => void;
  const promise = new Promise<T>((accept, decline) => {
    resolve = accept;
    reject = decline;
  });
  return { promise, resolve, reject };
}

function protocolError(message: string, cause?: unknown): RuntimeAdapterError {
  return new RuntimeAdapterError("SUBPROCESS_PROTOCOL_ERROR", message, cause);
}

export class OmpRpcSession {
  readonly #pending = new Map<string, Pending>();
  #process: ProcessSession | undefined;
  #ready: Deferred<undefined> | undefined;
  #turn: (Deferred<OmpTurnStatus> & { interrupted: boolean }) | undefined;
  #requestIndex = 0;
  #closed = false;
  #failure: RuntimeAdapterError | undefined;

  constructor(
    private readonly options: NormalizedOmpConfiguration,
    private readonly launcher: ProcessLauncher,
    private readonly events: OmpRpcSessionEvents,
  ) {}

  async start(cwd: string): Promise<void> {
    this.#ready = deferred<undefined>();
    void this.#ready.promise.catch(() => undefined);
    try {
      this.#process = await this.launcher.launch({
        command: this.options.command,
        args: this.options.args,
        cwd,
        environment: this.options.environment,
        maximumLineBytes: this.options.maximumLineBytes,
        onStdoutLine: (line) => this.#receive(line),
        onStderrLine: () => this.events.diagnostic(),
        onProtocolError: (error) => this.#fail(protocolError("OMP output failed.", error)),
      });
      if (this.#closed) {
        this.#process.signal("SIGKILL");
        await this.#process.completion;
        throw this.#failure ?? protocolError("OMP failed before startup completed.");
      }
      void this.#process.completion.then((exit) => {
        if (!this.#closed) this.#fail(new RuntimeAdapterError(
          "SUBPROCESS_EXITED",
          "OMP exited before the connector stopped it.",
          exit,
        ), false);
      });
      await this.#deadline(
        this.#ready.promise,
        this.options.startupTimeoutMilliseconds,
        "OMP did not become ready before its startup deadline.",
      );
    } catch (error: unknown) {
      const normalized = error instanceof RuntimeAdapterError
        ? error
        : new RuntimeAdapterError("SUBPROCESS_START_FAILED", "OMP failed to start.", error);
      if (this.#process === undefined) {
        this.#closed = true;
        this.#failure = normalized;
      } else this.#fail(normalized);
      throw normalized;
    }
  }

  request(command: string, extra: Record<string, unknown> = {}): Promise<unknown> {
    if (this.#closed || this.#process === undefined) {
      throw new RuntimeAdapterError("SUBPROCESS_EXITED", "OMP process is unavailable.");
    }
    const id = `omp-${++this.#requestIndex}`;
    const response = deferred<unknown>();
    const timeout = setTimeout(() => {
      const error = new RuntimeAdapterError("SUBPROCESS_TIMEOUT", "OMP RPC response timed out.");
      response.reject(error);
      this.#pending.delete(id);
      this.#fail(error);
    }, this.options.responseTimeoutMilliseconds);
    timeout.unref();
    this.#pending.set(id, { ...response, command, timeout });
    try { this.#process.send(encodeOmpCommand({ id, type: command, ...extra })); }
    catch (error: unknown) { this.#fail(protocolError("OMP input failed.", error)); }
    return response.promise;
  }

  async prompt(message: string, deadlineMilliseconds: number): Promise<OmpTurnStatus> {
    if (this.#turn !== undefined) {
      throw new RuntimeAdapterError("ADAPTER_BUSY", "OMP already has an active turn.");
    }
    this.#turn = { ...deferred<OmpTurnStatus>(), interrupted: false };
    const active = this.#turn;
    try {
      await this.request("prompt", { message });
      return await this.#deadline(
        active.promise,
        deadlineMilliseconds,
        "OMP exceeded the turn deadline.",
      );
    } catch (error: unknown) {
      const normalized = error instanceof RuntimeAdapterError
        ? error
        : protocolError("OMP turn failed.", error);
      this.#fail(normalized);
      throw normalized;
    } finally {
      this.#turn = undefined;
    }
  }

  async interrupt(): Promise<boolean> {
    const active = this.#turn;
    if (active === undefined) return false;
    active.interrupted = true;
    await this.request("abort");
    return true;
  }

  async configureHostTool(): Promise<void> {
    await this.request("set_host_tools", { tools: CODE_NEST_HOST_TOOLS });
  }

  async stop(): Promise<void> {
    const process = this.#process;
    if (process === undefined) return;
    if (this.#closed) {
      process.signal("SIGKILL");
      await process.completion;
      return;
    }
    this.#closed = true;
    process.signal("SIGTERM");
    const completed = await Promise.race([
      process.completion.then(() => true),
      new Promise<false>((resolve) => {
        const timeout = setTimeout(() => resolve(false), this.options.terminationGraceMilliseconds);
        timeout.unref();
      }),
    ]);
    if (!completed) { process.signal("SIGKILL"); await process.completion; }
  }

  #receive(line: string): void {
    try {
      const frame = parseOmpFrame(line);
      if (frame.type === "ignored") return;
      if (frame.type === "ready") { this.#ready?.resolve(undefined); return; }
      if (frame.type === "response") { this.#response(frame); return; }
      if (frame.type === "agent_end") {
        if (frame.terminal) {
          this.#turn?.resolve(this.#turn.interrupted ? "interrupted" : frame.status);
        }
        return;
      }
      if (frame.type === "tool_start" || frame.type === "tool_end") {
        this.events.tool({
          toolCallId: frame.toolCallId,
          toolName: frame.toolName,
          status: frame.type === "tool_start" ? "started" : frame.failed ? "failed" : "completed",
        });
        return;
      }
      this.#hostTool(frame);
    } catch (error: unknown) {
      this.#fail(error instanceof RuntimeAdapterError
        ? error
        : protocolError("OMP violated its RPC protocol.", error));
    }
  }

  #response(frame: Extract<ReturnType<typeof parseOmpFrame>, { type: "response" }>): void {
    const pending = this.#pending.get(frame.id);
    if (pending === undefined || pending.command !== frame.command) {
      throw protocolError("OMP response did not match an active request.");
    }
    clearTimeout(pending.timeout);
    this.#pending.delete(frame.id);
    if (frame.success) pending.resolve(frame.data);
    else pending.reject(protocolError("OMP rejected an RPC command."));
  }

  #hostTool(frame: Extract<ReturnType<typeof parseOmpFrame>, { type: "host_tool_call" }>): void {
    let failed = this.#turn === undefined;
    if (!failed) {
      try {
        if (frame.toolName === CODE_NEST_HOST_TOOL.name) {
          this.events.command(parseSubmittedCommand(frame.arguments));
        } else if (frame.toolName === CODE_NEST_RATIONALE_TOOL.name) {
          this.events.rationale(parseSubmittedRationale(frame.arguments));
        } else if (frame.toolName === CODE_NEST_MEMORY_TOOL.name) {
          this.events.memory(parseSubmittedMemory(frame.arguments));
        } else {
          failed = true;
        }
      }
      catch { failed = true; }
    }
    this.#process?.send(encodeHostToolResult(frame.id, failed));
  }

  #deadline<T>(promise: Promise<T>, milliseconds: number, message: string): Promise<T> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(
        new RuntimeAdapterError("SUBPROCESS_TIMEOUT", message),
      ), milliseconds);
      timeout.unref();
      void promise.then(
        (value) => { clearTimeout(timeout); resolve(value); },
        (error: unknown) => { clearTimeout(timeout); reject(error); },
      );
    });
  }

  #fail(error: RuntimeAdapterError, signal = true): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#failure = error;
    if (signal) this.#process?.signal("SIGKILL");
    this.#ready?.reject(error);
    this.#turn?.reject(error);
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.#pending.clear();
  }
}
