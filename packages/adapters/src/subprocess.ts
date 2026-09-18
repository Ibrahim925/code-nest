import { SubprocessRuntimeAdapter } from "./subprocess/application/subprocess-runtime-adapter.js";
import { NodeProcessLauncher } from "./subprocess/node/node-process-launcher.js";
import type { SubprocessConfiguration } from "./subprocess/domain/configuration.js";

export {
  SubprocessRuntimeAdapter,
  type SubprocessRuntimeAdapterOptions,
} from "./subprocess/application/subprocess-runtime-adapter.js";
export {
  SUBPROCESS_WIRE_VERSION,
  type SubprocessFrame,
  type SubprocessOperation,
  type SubprocessRequest,
} from "./subprocess/domain/wire.js";

export function createSubprocessRuntimeAdapter(
  configuration: SubprocessConfiguration,
): SubprocessRuntimeAdapter {
  return new SubprocessRuntimeAdapter(configuration, new NodeProcessLauncher());
}
