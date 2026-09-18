import type { ContainerCommandResult } from "./split-container-engine.js";
import type {
  NormalizedContainedRuntimeRequest,
  ObservedContainedNetwork,
} from "../domain/contained-container-policy.js";
import type {
  NormalizedSplitContainerCommand,
  ObservedContainerPolicy,
} from "../domain/split-container-policy.js";

export interface ContainedNetworkCreateRequest {
  readonly name: string;
  readonly internal: boolean;
  readonly runId: string;
  readonly participantId: string;
  readonly kind: "egress" | "private";
}

export interface ContainedRuntimeEngine {
  createNetwork(request: ContainedNetworkCreateRequest): Promise<string>;
  createBroker(request: NormalizedContainedRuntimeRequest): Promise<string>;
  connectNetwork(
    networkName: string,
    containerId: string,
    alias: string,
  ): Promise<void>;
  createParticipant(request: NormalizedContainedRuntimeRequest): Promise<string>;
  startContainer(containerId: string): Promise<void>;
  awaitBrokerReady(containerId: string, timeoutMilliseconds: number): Promise<void>;
  inspectContainer(containerId: string): Promise<ObservedContainerPolicy>;
  inspectNetwork(networkId: string): Promise<ObservedContainedNetwork>;
  executeParticipant(
    containerId: string,
    command: NormalizedSplitContainerCommand,
    limits: { readonly timeoutMilliseconds: number; readonly maximumOutputBytes: number },
  ): Promise<ContainerCommandResult>;
  brokerLogs(containerId: string, maximumBytes: number): Promise<Uint8Array>;
  stopContainer(containerId: string, graceSeconds: number): Promise<void>;
  removeContainer(containerId: string): Promise<void>;
  removeNetwork(networkId: string): Promise<void>;
}
