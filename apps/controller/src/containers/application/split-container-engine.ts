import type {
  NormalizedSplitContainerCommand,
  NormalizedSplitContainerRequest,
  ObservedContainerPolicy,
} from "../domain/split-container-policy.js";

export interface ContainerCommandResult {
  readonly exitCode: number;
  readonly stdout: Uint8Array;
  readonly stderr: Uint8Array;
}

export interface SplitContainerEngine {
  create(request: NormalizedSplitContainerRequest): Promise<string>;
  start(containerId: string): Promise<void>;
  inspect(containerId: string): Promise<ObservedContainerPolicy>;
  execute(
    containerId: string,
    command: NormalizedSplitContainerCommand,
    limits: { readonly timeoutMilliseconds: number; readonly maximumOutputBytes: number },
  ): Promise<ContainerCommandResult>;
  pause(containerId: string): Promise<void>;
  unpause(containerId: string): Promise<void>;
  stop(containerId: string, graceSeconds: number): Promise<void>;
  remove(containerId: string): Promise<void>;
}
