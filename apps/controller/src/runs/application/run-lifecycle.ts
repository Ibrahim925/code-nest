import { isDeepStrictEqual } from "node:util";

import type { RunSetupConfiguration } from "@code-nest/protocol";

import {
  canApplyRunAction,
  foldRunEvents,
  RunHistoryError,
  toRunView,
  type RunAction,
  type RunView,
} from "../domain/lifecycle.js";
import type { RunLifecycleUseCases } from "./ports/run-lifecycle.js";
import type { RunLifecycleStore } from "./ports/run-lifecycle-store.js";

export type RunApplicationErrorCode =
  | "IDEMPOTENCY_KEY_REUSED"
  | "RUN_ALREADY_EXISTS"
  | "RUN_NOT_FOUND"
  | "RUN_STATE_CONFLICT";

export class RunApplicationError extends Error {
  constructor(
    readonly code: RunApplicationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "RunApplicationError";
  }
}

export interface RunLifecycleDependencies {
  readonly store: RunLifecycleStore;
  readonly now: () => Date;
  readonly createEventId: () => string;
}

export class RunLifecycleService implements RunLifecycleUseCases {
  constructor(private readonly dependencies: RunLifecycleDependencies) {}

  create(
    runId: string,
    commandId: string,
    configuration?: RunSetupConfiguration,
  ): RunView {
    const duplicate = this.#duplicate(
      runId,
      commandId,
      "create",
      configuration,
    );
    if (duplicate !== undefined) return duplicate;

    if (this.dependencies.store.hasEvents(runId)) {
      if (this.#read(runId) === undefined) {
        throw new RunHistoryError(
          `Run ${runId} has events but no creation event.`,
        );
      }
      throw new RunApplicationError(
        "RUN_ALREADY_EXISTS",
        `Run ${runId} already exists.`,
      );
    }

    return this.#append(runId, commandId, "create", undefined, configuration);
  }

  get(runId: string): RunView {
    const state = this.#read(runId);
    if (state === undefined) {
      throw new RunApplicationError("RUN_NOT_FOUND", "Run was not found.");
    }
    return toRunView(state);
  }

  pause(runId: string, commandId: string): RunView {
    return this.#mutate(runId, commandId, "pause");
  }

  resume(runId: string, commandId: string): RunView {
    return this.#mutate(runId, commandId, "resume");
  }

  cancel(runId: string, commandId: string): RunView {
    return this.#mutate(runId, commandId, "cancel");
  }

  #read(runId: string, throughSequence?: number) {
    return foldRunEvents(
      this.dependencies.store.listEvents(runId, throughSequence),
    );
  }

  #duplicate(
    runId: string,
    commandId: string,
    action: RunAction,
    configuration?: RunSetupConfiguration,
  ): RunView | undefined {
    const result = this.dependencies.store.getCommandResult(runId, commandId);
    if (result === undefined) return undefined;
    if (
      result.kind === "other" ||
      result.event.action !== action ||
      (action === "create" &&
        !isDeepStrictEqual(result.event.configuration, configuration))
    ) {
      throw new RunApplicationError(
        "IDEMPOTENCY_KEY_REUSED",
        "The idempotency key was used for another action.",
      );
    }

    const state = this.#read(runId, result.event.sequence);
    if (state === undefined) {
      throw new RunHistoryError(
        `Command ${commandId} has no resulting run state.`,
      );
    }
    return toRunView(state);
  }

  #mutate(
    runId: string,
    commandId: string,
    action: Exclude<RunAction, "create">,
  ): RunView {
    const duplicate = this.#duplicate(runId, commandId, action);
    if (duplicate !== undefined) return duplicate;

    const state = this.#read(runId);
    if (state === undefined) {
      throw new RunApplicationError("RUN_NOT_FOUND", "Run was not found.");
    }
    if (!canApplyRunAction(state, action)) {
      throw new RunApplicationError(
        "RUN_STATE_CONFLICT",
        `Run ${runId} cannot ${action} while ${state.status}.`,
      );
    }
    return this.#append(runId, commandId, action, state.lastEventId);
  }

  #append(
    runId: string,
    commandId: string,
    action: RunAction,
    parentEventId?: string,
    configuration?: RunSetupConfiguration,
  ): RunView {
    const event = this.dependencies.store.append(commandId, {
      eventId: this.dependencies.createEventId(),
      runId,
      recordedAt: this.dependencies.now().toISOString(),
      action,
      commandId,
      ...(configuration === undefined ? {} : { configuration }),
      ...(parentEventId === undefined ? {} : { parentEventId }),
    });
    const state = this.#read(runId, event.sequence);
    if (state === undefined) {
      throw new RunHistoryError(`Run ${runId} has no state after ${action}.`);
    }
    return toRunView(state);
  }
}
