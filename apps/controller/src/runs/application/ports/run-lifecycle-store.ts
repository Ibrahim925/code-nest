import type {
  RunAction,
  RunLifecycleEvent,
} from "../../domain/lifecycle.js";

export interface RunEventDraft {
  readonly eventId: string;
  readonly runId: string;
  readonly recordedAt: string;
  readonly action: RunAction;
  readonly commandId: string;
  readonly parentEventId?: string;
}

export type StoredCommandResult =
  | { readonly kind: "lifecycle"; readonly event: RunLifecycleEvent }
  | { readonly kind: "other" };

export interface RunLifecycleStore {
  hasEvents(runId: string): boolean;
  listEvents(runId: string, throughSequence?: number): RunLifecycleEvent[];
  getCommandResult(
    runId: string,
    commandId: string,
  ): StoredCommandResult | undefined;
  append(commandId: string, draft: RunEventDraft): RunLifecycleEvent;
}

export class RunStoreError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "RunStoreError";
  }
}
