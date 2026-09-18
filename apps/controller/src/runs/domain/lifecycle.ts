import type { RunSetupConfiguration } from "@code-nest/protocol";

export const RUN_EVENT_KINDS = {
  create: "run.created",
  pause: "run.paused",
  resume: "run.resumed",
  cancel: "run.cancelled",
} as const;

export type RunAction = keyof typeof RUN_EVENT_KINDS;
export type RunStatus = "running" | "paused" | "cancelled";

export interface RunLifecycleEvent {
  readonly eventId: string;
  readonly runId: string;
  readonly sequence: number;
  readonly recordedAt: string;
  readonly action: RunAction;
  readonly configuration?: RunSetupConfiguration;
}

export interface RunView {
  readonly schemaVersion: "1.0";
  readonly runId: string;
  readonly status: RunStatus;
  readonly terminalReason: "operator_cancelled" | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly lastEventSequence: number;
}

export interface RunState extends RunView {
  readonly lastEventId: string;
}

export class RunHistoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RunHistoryError";
  }
}

export function canApplyRunAction(state: RunState, action: RunAction): boolean {
  return (
    (action === "pause" && state.status === "running") ||
    (action === "resume" && state.status === "paused") ||
    (action === "cancel" &&
      (state.status === "running" || state.status === "paused"))
  );
}

export function applyRunEvent(
  state: RunState | undefined,
  event: RunLifecycleEvent,
): RunState {
  if (event.action === "create") {
    if (state !== undefined) {
      throw new RunHistoryError(
        `Run ${event.runId} has more than one creation event.`,
      );
    }
    if (event.sequence !== 1) {
      throw new RunHistoryError(
        `Run ${event.runId} was not created by its first event.`,
      );
    }
    return {
      schemaVersion: "1.0",
      runId: event.runId,
      status: "running",
      terminalReason: null,
      createdAt: event.recordedAt,
      updatedAt: event.recordedAt,
      lastEventSequence: event.sequence,
      lastEventId: event.eventId,
    };
  }

  if (state === undefined) {
    throw new RunHistoryError(
      `Run ${event.runId} changed state before creation.`,
    );
  }
  if (
    event.runId !== state.runId ||
    event.sequence <= state.lastEventSequence ||
    !canApplyRunAction(state, event.action)
  ) {
    throw new RunHistoryError(
      `Run ${event.runId} has an invalid ${event.action} transition.`,
    );
  }

  return {
    ...state,
    status:
      event.action === "pause"
        ? "paused"
        : event.action === "resume"
          ? "running"
          : "cancelled",
    terminalReason:
      event.action === "cancel" ? "operator_cancelled" : null,
    updatedAt: event.recordedAt,
    lastEventSequence: event.sequence,
    lastEventId: event.eventId,
  };
}

export function foldRunEvents(
  events: readonly RunLifecycleEvent[],
): RunState | undefined {
  return events.reduce<RunState | undefined>(applyRunEvent, undefined);
}

export function toRunView(state: RunState): RunView {
  return {
    schemaVersion: state.schemaVersion,
    runId: state.runId,
    status: state.status,
    terminalReason: state.terminalReason,
    createdAt: state.createdAt,
    updatedAt: state.updatedAt,
    lastEventSequence: state.lastEventSequence,
  };
}
