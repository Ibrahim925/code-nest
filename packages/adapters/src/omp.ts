import { OmpRuntimeAdapter } from "./omp/application/omp-runtime-adapter.js";
import { NodeProcessLauncher } from "./subprocess/node/node-process-launcher.js";
import type { OmpConfiguration } from "./omp/domain/configuration.js";
import type { OmpObservabilityOptions } from "./omp/application/omp-observability.js";

export { OmpRuntimeAdapter } from "./omp/application/omp-runtime-adapter.js";
export {
  type OmpCaptureReason,
  type OmpComputerCapture,
  type OmpComputerCapturePort,
  type OmpObservabilityFact,
  type OmpObservabilityOptions,
  type OmpObservabilitySink,
} from "./omp/application/omp-observability.js";
export {
  normalizeOmpConfiguration,
  type NormalizedOmpConfiguration,
  type OmpConfiguration,
  type OmpThinkingLevel,
} from "./omp/domain/configuration.js";

export function createOmpRuntimeAdapter(
  configuration: OmpConfiguration,
  observability: OmpObservabilityOptions = {},
): OmpRuntimeAdapter {
  return new OmpRuntimeAdapter(
    configuration,
    new NodeProcessLauncher(),
    observability,
  );
}
