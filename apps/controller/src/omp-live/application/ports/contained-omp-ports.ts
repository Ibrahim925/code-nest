import type {
  OmpComputerCapturePort,
  OmpConfiguration,
  OmpObservabilityOptions,
  OmpObservabilitySink,
  ProcessLauncher,
  RuntimeAdapter,
} from "@code-nest/adapters";

import type {
  ContainedRuntimeFinalReport,
  ContainedRuntimeManifest,
  ContainedRuntimeRequest,
} from "../../../containers/index.js";
import type { ContainerCommandResult } from "../../../containers/application/split-container-engine.js";
import type { SplitContainerCommand } from "../../../containers/domain/split-container-policy.js";
import type { ParticipantWorkspace } from "../../../workspaces/domain/workspace.js";

export interface ContainedOmpBoundary {
  start(request: ContainedRuntimeRequest): Promise<ContainedRuntimeManifest>;
  execute(command: SplitContainerCommand): Promise<ContainerCommandResult>;
  stop(reason: string): Promise<ContainedRuntimeFinalReport>;
}

export interface ContainedOmpDependencies {
  createBoundary(): ContainedOmpBoundary;
  createProcessLauncher(
    containerId: string,
    hostWorkspacePath: string,
  ): ProcessLauncher;
  createRuntimeAdapter(
    configuration: OmpConfiguration,
    launcher: ProcessLauncher,
    observability: OmpObservabilityOptions,
  ): RuntimeAdapter;
  createObservabilitySink(
    runId: string,
    participantId: string,
  ): OmpObservabilitySink;
  createComputerCapture(
    boundary: ContainedOmpBoundary,
    participantId: string,
  ): OmpComputerCapturePort;
}

export interface SynchronizedWorkspace {
  readonly candidateRevision: string;
  readonly commitSummary: string;
}

export interface ContainedWorkspaceSynchronizer {
  synchronize(
    boundary: ContainedOmpBoundary,
    workspace: ParticipantWorkspace,
  ): Promise<SynchronizedWorkspace>;
}
