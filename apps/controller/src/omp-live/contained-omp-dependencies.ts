import { NodeProcessLauncher, OmpRuntimeAdapter } from "@code-nest/adapters";

import {
  ContainedRuntime,
  DockerContainedRuntimeEngine,
  DockerExecProcessLauncher,
  NodeDockerCommandRunner,
} from "../containers/index.js";
import type { RecordObservationService } from "../observability/application/record-observation.js";
import { RecordObservabilitySink } from "./adapters/record-observability-sink.js";
import { WorkspaceComputerCapture } from "./adapters/workspace-computer-capture.js";
import type { ContainedOmpDependencies } from "./application/ports/contained-omp-ports.js";
import {
  RequiredToolchainPreflight,
  type RequiredParticipantTool,
} from "./application/required-toolchain-preflight.js";

export function createContainedOmpDependencies(input: {
  readonly allowedWorkspaceRoot: string;
  readonly brokerSourcePath: string;
  readonly trustedCodeRoot: string;
  readonly observations: RecordObservationService;
  readonly requiredParticipantTools: readonly RequiredParticipantTool[];
  readonly context: () => {
    readonly round: number | null;
    readonly phase: string | null;
  };
}): ContainedOmpDependencies {
  const engine = new DockerContainedRuntimeEngine(new NodeDockerCommandRunner());
  return {
    createBoundary: () => new ContainedRuntime(engine, {
      allowedWorkspaceRoot: input.allowedWorkspaceRoot,
      brokerSourcePath: input.brokerSourcePath,
      trustedCodeRoot: input.trustedCodeRoot,
    }),
    createProcessLauncher: (containerId, workspacePath) =>
      new DockerExecProcessLauncher(
        containerId,
        workspacePath,
        new NodeProcessLauncher(),
      ),
    createRuntimeAdapter: (configuration, launcher, observability) =>
      new OmpRuntimeAdapter(configuration, launcher, observability),
    createObservabilitySink: (runId, participantId) =>
      new RecordObservabilitySink(
        input.observations,
        runId,
        participantId,
        input.context,
      ),
    createComputerCapture: (boundary, participantId) =>
      new WorkspaceComputerCapture(boundary, participantId),
    preflight: new RequiredToolchainPreflight(input.requiredParticipantTools),
  };
}
