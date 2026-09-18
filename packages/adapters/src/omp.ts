import { OmpRuntimeAdapter } from "./omp/application/omp-runtime-adapter.js";
import { NodeProcessLauncher } from "./subprocess/node/node-process-launcher.js";
import type { OmpConfiguration } from "./omp/domain/configuration.js";

export { OmpRuntimeAdapter } from "./omp/application/omp-runtime-adapter.js";
export {
  normalizeOmpConfiguration,
  type NormalizedOmpConfiguration,
  type OmpConfiguration,
  type OmpThinkingLevel,
} from "./omp/domain/configuration.js";

export function createOmpRuntimeAdapter(configuration: OmpConfiguration): OmpRuntimeAdapter {
  return new OmpRuntimeAdapter(configuration, new NodeProcessLauncher());
}
