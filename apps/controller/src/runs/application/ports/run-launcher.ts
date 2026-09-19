import type { RunSetupConfiguration } from "@code-nest/protocol";

export interface RunExecutor {
  execute(configuration: RunSetupConfiguration): Promise<void>;
}

export interface RunLaunchFailureReporter {
  report(runId: string, error: unknown): void;
}

export interface RunLauncher {
  launch(configuration: RunSetupConfiguration): Promise<void>;
}
