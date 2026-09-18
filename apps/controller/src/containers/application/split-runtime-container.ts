import type {
  ContainerCommandResult,
  SplitContainerEngine,
} from "./split-container-engine.js";
import {
  assertObservedContainerPolicy,
  normalizeSplitContainerCommand,
  normalizeSplitContainerRequest,
  splitContainerManifest,
  SplitContainerError,
  type NormalizedSplitContainerRequest,
  type SplitContainerCommand,
  type SplitContainerManifest,
  type SplitContainerRequest,
} from "../domain/split-container-policy.js";

type State = "idle" | "starting" | "running" | "frozen" | "stopped";

export interface SplitContainerFinalReport {
  readonly manifest: SplitContainerManifest;
  readonly status: "stopped";
  readonly stopReason: string;
  readonly commandsCompleted: number;
}

function reason(value: string): string {
  if (value.length === 0 || value.length > 256 || value.includes("\0")) {
    throw new SplitContainerError("INVALID_CONTAINER_INPUT", "Container stop reason is invalid.");
  }
  return value;
}

export class SplitRuntimeContainer {
  #state: State = "idle";
  #request: NormalizedSplitContainerRequest | undefined;
  #containerId: string | undefined;
  #manifest: SplitContainerManifest | undefined;
  #finalReport: SplitContainerFinalReport | undefined;
  #commandsCompleted = 0;

  constructor(
    private readonly allowedWorkspaceRoot: string,
    private readonly engine: SplitContainerEngine,
  ) {}

  async start(request: SplitContainerRequest): Promise<SplitContainerManifest> {
    if (this.#state !== "idle") {
      throw new SplitContainerError("CONTAINER_ALREADY_STARTED", "Split container already started.");
    }
    this.#request = normalizeSplitContainerRequest(request, this.allowedWorkspaceRoot);
    this.#state = "starting";
    try {
      this.#containerId = await this.engine.create(this.#request);
      await this.engine.start(this.#containerId);
      const observed = await this.engine.inspect(this.#containerId);
      assertObservedContainerPolicy(this.#request, observed);
      this.#manifest = splitContainerManifest(this.#request, this.#containerId);
      this.#state = "running";
      return structuredClone(this.#manifest);
    } catch (error: unknown) {
      const cleanupError = await this.#forceRemove();
      this.#state = "stopped";
      if (cleanupError !== undefined) {
        throw new SplitContainerError(
          "CONTAINER_CLEANUP_FAILED",
          "Split container failed to start and its partial resource could not be removed.",
          new AggregateError([error, cleanupError]),
        );
      }
      if (error instanceof SplitContainerError) throw error;
      throw new SplitContainerError(
        "CONTAINER_START_FAILED",
        "Split container failed to start; its partial resource was removed.",
        error,
      );
    }
  }

  async execute(command: SplitContainerCommand): Promise<ContainerCommandResult> {
    const request = this.#requireState("running");
    const normalized = normalizeSplitContainerCommand(command);
    try {
      const result = await this.engine.execute(this.#containerId as string, normalized, {
        timeoutMilliseconds: request.limits.commandTimeoutMilliseconds,
        maximumOutputBytes: request.limits.maximumOutputBytes,
      });
      this.#commandsCompleted += 1;
      return {
        exitCode: result.exitCode,
        stdout: new Uint8Array(result.stdout),
        stderr: new Uint8Array(result.stderr),
      };
    } catch (error: unknown) {
      const cleanupError = await this.#forceRemove();
      this.#state = "stopped";
      if (cleanupError !== undefined) {
        throw new SplitContainerError(
          "CONTAINER_CLEANUP_FAILED",
          "A limited command failed and its container could not be removed.",
          new AggregateError([error, cleanupError]),
        );
      }
      if (error instanceof SplitContainerError) throw error;
      throw new SplitContainerError(
        "CONTAINER_ENGINE_FAILURE",
        "Container command transport failed; the container was removed.",
        error,
      );
    }
  }

  async freeze(): Promise<void> {
    this.#requireState("running");
    try {
      await this.engine.pause(this.#containerId as string);
      const observed = await this.engine.inspect(this.#containerId as string);
      if (!observed.running || !observed.paused) {
        throw new SplitContainerError("CONTAINER_POLICY_MISMATCH", "Container did not freeze.");
      }
      this.#state = "frozen";
    } catch (error: unknown) {
      await this.#failClosed(error, "Container freeze failed; the container was removed.");
    }
  }

  async thaw(): Promise<void> {
    this.#requireState("frozen");
    try {
      await this.engine.unpause(this.#containerId as string);
      const observed = await this.engine.inspect(this.#containerId as string);
      assertObservedContainerPolicy(this.#request as NormalizedSplitContainerRequest, observed);
      this.#state = "running";
    } catch (error: unknown) {
      await this.#failClosed(error, "Container thaw failed; the container was removed.");
    }
  }

  async stop(stopReason: string): Promise<SplitContainerFinalReport> {
    if (this.#finalReport !== undefined) return structuredClone(this.#finalReport);
    const request = this.#requireStarted();
    const acceptedReason = reason(stopReason);
    let failure: unknown;
    try {
      if (this.#state === "frozen") await this.engine.unpause(this.#containerId as string);
      if (this.#state === "running" || this.#state === "frozen") {
        await this.engine.stop(this.#containerId as string, request.limits.stopGraceSeconds);
      }
    } catch (error: unknown) {
      failure = error;
    }
    const cleanupError = await this.#forceRemove();
    this.#state = "stopped";
    if (failure !== undefined || cleanupError !== undefined) {
      throw new SplitContainerError(
        "CONTAINER_CLEANUP_FAILED",
        "Split container could not complete verified cleanup.",
        new AggregateError([failure, cleanupError].filter((value) => value !== undefined)),
      );
    }
    this.#finalReport = {
      manifest: structuredClone(this.#manifest as SplitContainerManifest),
      status: "stopped",
      stopReason: acceptedReason,
      commandsCompleted: this.#commandsCompleted,
    };
    return structuredClone(this.#finalReport);
  }

  #requireState(expected: "running" | "frozen"): NormalizedSplitContainerRequest {
    if (this.#state !== expected || this.#request === undefined || this.#containerId === undefined) {
      throw new SplitContainerError("CONTAINER_NOT_RUNNING", `Split container is not ${expected}.`);
    }
    return this.#request;
  }

  #requireStarted(): NormalizedSplitContainerRequest {
    if (this.#state === "idle" || this.#state === "starting" || this.#request === undefined) {
      throw new SplitContainerError("CONTAINER_NOT_RUNNING", "Split container has not started.");
    }
    return this.#request;
  }

  async #forceRemove(): Promise<unknown | undefined> {
    if (this.#containerId === undefined) return undefined;
    try {
      await this.engine.remove(this.#containerId);
      return undefined;
    } catch (error: unknown) {
      return error;
    }
  }

  async #failClosed(error: unknown, message: string): Promise<never> {
    const cleanupError = await this.#forceRemove();
    this.#state = "stopped";
    if (cleanupError !== undefined) {
      throw new SplitContainerError(
        "CONTAINER_CLEANUP_FAILED",
        message,
        new AggregateError([error, cleanupError]),
      );
    }
    if (error instanceof SplitContainerError) throw error;
    throw new SplitContainerError("CONTAINER_ENGINE_FAILURE", message, error);
  }
}
