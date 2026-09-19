import type { RunSetupConfiguration } from "@code-nest/protocol";

import type {
  RunExecutor,
  RunLauncher,
  RunLaunchFailureReporter,
} from "./ports/run-launcher.js";

export class BackgroundRunLauncher implements RunLauncher {
  readonly #launches = new Map<string, Promise<void>>();

  constructor(
    private readonly executor: RunExecutor,
    private readonly failures: RunLaunchFailureReporter,
  ) {}

  launch(configuration: RunSetupConfiguration): Promise<void> {
    const existing = this.#launches.get(configuration.runId);
    if (existing !== undefined) return existing;

    const launched = this.executor
      .execute(structuredClone(configuration))
      .catch((error: unknown) => {
        this.failures.report(configuration.runId, error);
      });
    this.#launches.set(configuration.runId, launched);
    return launched;
  }
}
