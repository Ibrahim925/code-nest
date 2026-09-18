import type { EventAudience, EventProjectionContext } from "@code-nest/core";

import type { ObserverModeStore } from "./ports/observer-mode-store.js";
import {
  projectObserverMode,
  type ObserverModeView,
} from "../domain/observer-mode.js";

export class ObserverModeError extends Error {
  constructor(
    readonly code: "RUN_NOT_FOUND" | "IDEMPOTENCY_KEY_REUSED" | "OBSERVER_MODE_UNAVAILABLE",
    message: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "ObserverModeError";
  }
}

export interface ObserverModeUseCases {
  get(runId: string): ObserverModeView;
  unblind(runId: string, commandId: string): ObserverModeView;
  projection(runId: string): EventProjectionContext;
  artifactAudience(runId: string): {
    readonly audience: EventAudience;
    readonly revealState: EventProjectionContext["revealState"];
  };
}

export interface ObserverModeDependencies {
  readonly store: ObserverModeStore;
  readonly now: () => Date;
  readonly createEventId: () => string;
}

export class ObserverModeService implements ObserverModeUseCases {
  constructor(private readonly dependencies: ObserverModeDependencies) {}

  get(runId: string): ObserverModeView {
    try {
      const state = projectObserverMode(runId, this.dependencies.store.listEvents(runId));
      if (state === undefined) {
        throw new ObserverModeError("RUN_NOT_FOUND", "Run was not found.");
      }
      return state;
    } catch (error: unknown) {
      if (error instanceof ObserverModeError) throw error;
      throw new ObserverModeError(
        "OBSERVER_MODE_UNAVAILABLE",
        "Observer mode state is unavailable.",
        error,
      );
    }
  }

  unblind(runId: string, commandId: string): ObserverModeView {
    const previous = this.dependencies.store.getCommandResult(runId, commandId);
    if (previous !== undefined) {
      if (previous.kind !== "observer_unblinded") {
        throw new ObserverModeError(
          "IDEMPOTENCY_KEY_REUSED",
          "The idempotency key was used for another action.",
        );
      }
      return this.get(runId);
    }
    const events = this.dependencies.store.listEvents(runId);
    const current = projectObserverMode(runId, events);
    if (current === undefined) {
      throw new ObserverModeError("RUN_NOT_FOUND", "Run was not found.");
    }
    const hasExplicitAudit = events.some(({ kind }) => kind === "observer_unblinded");
    if (current.mode === "post_match_reveal" || hasExplicitAudit) return current;
    const parent = events.at(-1);
    if (parent === undefined) {
      throw new ObserverModeError("RUN_NOT_FOUND", "Run was not found.");
    }
    this.dependencies.store.appendUnblinded({
      runId,
      commandId,
      eventId: this.dependencies.createEventId(),
      recordedAt: this.dependencies.now().toISOString(),
      parentEventId: parent.eventId,
    });
    return this.get(runId);
  }

  projection(runId: string): EventProjectionContext {
    const state = this.get(runId);
    return {
      runId,
      revealState: state.mode === "post_match_reveal" ? "revealed" : "sealed",
      audience: {
        kind: "observer",
        mode: state.mode === "unblinded" ? "unblinded" : "clean",
      },
    };
  }

  artifactAudience(runId: string) {
    const { audience, revealState } = this.projection(runId);
    return { audience, revealState };
  }
}
