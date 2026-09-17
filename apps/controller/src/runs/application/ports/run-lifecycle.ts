import type { RunView } from "../../domain/lifecycle.js";

export interface RunLifecycleUseCases {
  create(runId: string, commandId: string): RunView;
  get(runId: string): RunView;
  pause(runId: string, commandId: string): RunView;
  resume(runId: string, commandId: string): RunView;
  cancel(runId: string, commandId: string): RunView;
}
