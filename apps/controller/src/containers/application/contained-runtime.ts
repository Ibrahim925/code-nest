import type { ContainerCommandResult } from "./split-container-engine.js";
import type { ContainedRuntimeEngine } from "./contained-runtime-engine.js";
import {
  assertContainedRuntimePolicy,
  containedRuntimeManifest,
  normalizeContainedRuntimeRequest,
  type ContainedClock,
  type ContainedRuntimeManifest,
  type ContainedRuntimeRequest,
  type ContainedSecretFactory,
  type NormalizedContainedRuntimeRequest,
} from "../domain/contained-container-policy.js";
import {
  normalizeSplitContainerCommand,
  SplitContainerError,
  type SplitContainerCommand,
} from "../domain/split-container-policy.js";

type State = "idle" | "starting" | "running" | "stopped";

interface Resources {
  egressNetworkId?: string;
  privateNetworkId?: string;
  brokerContainerId?: string;
  participantContainerId?: string;
}

export interface ContainedRuntimeFinalReport {
  readonly manifest: ContainedRuntimeManifest;
  readonly status: "stopped";
  readonly stopReason: string;
  readonly commandsCompleted: number;
}

export class ContainedRuntime {
  #state: State = "idle";
  #request: NormalizedContainedRuntimeRequest | undefined;
  #resources: Resources = {};
  #manifest: ContainedRuntimeManifest | undefined;
  #report: ContainedRuntimeFinalReport | undefined;
  #commandsCompleted = 0;

  constructor(
    private readonly engine: ContainedRuntimeEngine,
    private readonly paths: {
      readonly allowedWorkspaceRoot: string;
      readonly brokerSourcePath: string;
      readonly trustedCodeRoot: string;
    },
    private readonly dependencies: {
      readonly secrets?: ContainedSecretFactory;
      readonly clock?: ContainedClock;
    } = {},
  ) {}

  async start(input: ContainedRuntimeRequest): Promise<ContainedRuntimeManifest> {
    if (this.#state !== "idle") {
      throw new SplitContainerError("CONTAINER_ALREADY_STARTED", "Contained runtime already started.");
    }
    this.#request = normalizeContainedRuntimeRequest(input, {
      ...this.paths,
      ...this.dependencies,
    });
    this.#state = "starting";
    try {
      const request = this.#request;
      this.#resources.egressNetworkId = await this.engine.createNetwork({
        name: request.egressNetworkName,
        internal: false,
        runId: request.participant.runId,
        participantId: request.participant.participantId,
        kind: "egress",
      });
      this.#resources.privateNetworkId = await this.engine.createNetwork({
        name: request.privateNetworkName,
        internal: true,
        runId: request.participant.runId,
        participantId: request.participant.participantId,
        kind: "private",
      });
      this.#resources.brokerContainerId = await this.engine.createBroker(request);
      await this.engine.connectNetwork(
        request.privateNetworkName,
        this.#resources.brokerContainerId,
        "code-nest-broker",
      );
      await this.engine.startContainer(this.#resources.brokerContainerId);
      await this.engine.awaitBrokerReady(this.#resources.brokerContainerId, 10_000);
      this.#resources.participantContainerId = await this.engine.createParticipant(request);
      await this.engine.startContainer(this.#resources.participantContainerId);
      const observed = await this.#observe();
      assertContainedRuntimePolicy(request, observed);
      this.#manifest = containedRuntimeManifest(request, {
        participantContainerId: this.#resources.participantContainerId,
        brokerContainerId: this.#resources.brokerContainerId,
        privateNetworkId: this.#resources.privateNetworkId,
        egressNetworkId: this.#resources.egressNetworkId,
      });
      this.#state = "running";
      return structuredClone(this.#manifest);
    } catch (error: unknown) {
      const cleanupError = await this.#cleanup();
      this.#state = "stopped";
      if (cleanupError !== undefined) {
        throw new SplitContainerError(
          "CONTAINER_CLEANUP_FAILED",
          "Contained runtime startup failed and partial resources could not be removed.",
          new AggregateError([error, cleanupError]),
        );
      }
      if (error instanceof SplitContainerError) throw error;
      throw new SplitContainerError(
        "CONTAINER_START_FAILED",
        "Contained runtime startup failed; partial resources were removed.",
        error,
      );
    }
  }

  async execute(command: SplitContainerCommand): Promise<ContainerCommandResult> {
    const request = this.#running();
    try {
      const result = await this.engine.executeParticipant(
        this.#resources.participantContainerId as string,
        normalizeSplitContainerCommand(command),
        {
          timeoutMilliseconds: request.participant.limits.commandTimeoutMilliseconds,
          maximumOutputBytes: request.participant.limits.maximumOutputBytes,
        },
      );
      this.#commandsCompleted += 1;
      return {
        exitCode: result.exitCode,
        stdout: new Uint8Array(result.stdout),
        stderr: new Uint8Array(result.stderr),
      };
    } catch (error: unknown) {
      const cleanupError = await this.#cleanup();
      this.#state = "stopped";
      if (cleanupError !== undefined) {
        throw new SplitContainerError(
          "CONTAINER_CLEANUP_FAILED",
          "Contained command failed and resources could not be removed.",
          new AggregateError([error, cleanupError]),
        );
      }
      if (error instanceof SplitContainerError) throw error;
      throw new SplitContainerError("CONTAINER_ENGINE_FAILURE", "Contained command transport failed.", error);
    }
  }

  async brokerLogs(): Promise<Uint8Array> {
    this.#running();
    return this.engine.brokerLogs(this.#resources.brokerContainerId as string, 1024 * 1024);
  }

  async stop(stopReason: string): Promise<ContainedRuntimeFinalReport> {
    if (this.#report !== undefined) return structuredClone(this.#report);
    const request = this.#running();
    if (stopReason.length === 0 || stopReason.length > 256 || stopReason.includes("\0")) {
      throw new SplitContainerError("INVALID_CONTAINER_INPUT", "Contained runtime stop reason is invalid.");
    }
    const errors: unknown[] = [];
    for (const id of [this.#resources.participantContainerId, this.#resources.brokerContainerId]) {
      if (id === undefined) continue;
      try { await this.engine.stopContainer(id, request.participant.limits.stopGraceSeconds); }
      catch (error: unknown) { errors.push(error); }
    }
    const cleanupError = await this.#cleanup();
    if (cleanupError !== undefined) errors.push(cleanupError);
    this.#state = "stopped";
    if (errors.length > 0) {
      throw new SplitContainerError(
        "CONTAINER_CLEANUP_FAILED",
        "Contained runtime could not complete verified cleanup.",
        new AggregateError(errors),
      );
    }
    this.#report = {
      manifest: structuredClone(this.#manifest as ContainedRuntimeManifest),
      status: "stopped",
      stopReason,
      commandsCompleted: this.#commandsCompleted,
    };
    return structuredClone(this.#report);
  }

  async #observe() {
    return {
      participant: await this.engine.inspectContainer(this.#resources.participantContainerId as string),
      broker: await this.engine.inspectContainer(this.#resources.brokerContainerId as string),
      privateNetwork: await this.engine.inspectNetwork(this.#resources.privateNetworkId as string),
      egressNetwork: await this.engine.inspectNetwork(this.#resources.egressNetworkId as string),
    };
  }

  #running(): NormalizedContainedRuntimeRequest {
    if (this.#state !== "running" || this.#request === undefined) {
      throw new SplitContainerError("CONTAINER_NOT_RUNNING", "Contained runtime is not running.");
    }
    return this.#request;
  }

  async #cleanup(): Promise<unknown | undefined> {
    const errors: unknown[] = [];
    for (const id of [this.#resources.participantContainerId, this.#resources.brokerContainerId]) {
      if (id === undefined) continue;
      try { await this.engine.removeContainer(id); } catch (error: unknown) { errors.push(error); }
    }
    for (const id of [this.#resources.privateNetworkId, this.#resources.egressNetworkId]) {
      if (id === undefined) continue;
      try { await this.engine.removeNetwork(id); } catch (error: unknown) { errors.push(error); }
    }
    return errors.length === 0 ? undefined : new AggregateError(errors);
  }
}
