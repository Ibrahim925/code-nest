import {
  projectEventForAudience,
  type EventProjectionContext,
} from "@code-nest/core";
import {
  EVENT_DELIVERY_VERSION,
  REPLAY_BUNDLE_VERSION,
  REPLAY_PROJECTOR_VERSION,
  parseRunSetupConfiguration,
  parseReplayBundle,
  type EventEnvelope,
  type ReplayArtifact,
  type ReplayBundle,
} from "@code-nest/protocol";

import type { ObserverModeView } from "../../observer/domain/observer-mode.js";
import type { ReplaySource } from "./ports/replay-source.js";

export type ReplayExportErrorCode =
  | "RUN_NOT_FOUND"
  | "RUN_NOT_TERMINAL"
  | "REPLAY_INCOMPLETE"
  | "REPLAY_SOURCE_UNAVAILABLE";

export class ReplayExportError extends Error {
  constructor(
    readonly code: ReplayExportErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "ReplayExportError";
  }
}

export interface ReplayExportUseCases {
  export(input: {
    readonly context: EventProjectionContext;
    readonly observerMode: ObserverModeView;
  }): Promise<ReplayBundle>;
}

function terminal(events: readonly EventEnvelope[]) {
  const event = events.findLast(({ kind }) =>
    kind === "match.completed" || kind === "run.cancelled"
  );
  if (event === undefined) return undefined;
  return {
    kind: event.kind === "match.completed" ? "completed" as const : "cancelled" as const,
    eventId: event.eventId,
  };
}

function deliveries(events: readonly EventEnvelope[]) {
  return events.map((event, index) => {
    const { sequence: _sourceSequence, ...portableEvent } = event;
    void _sourceSequence;
    return {
      deliveryVersion: EVENT_DELIVERY_VERSION,
      deliverySequence: index + 1,
      event: portableEvent,
    };
  });
}

function referencedDigests(events: readonly EventEnvelope[]): string[] {
  return [...new Set(events.flatMap(({ artifactDigests }) => artifactDigests))].sort();
}

function hasPortableConfiguration(events: readonly EventEnvelope[]): boolean {
  const created = events.find(({ kind }) => kind === "run.created");
  if (
    created === undefined || typeof created.payload !== "object" ||
    created.payload === null || Array.isArray(created.payload)
  ) return false;
  return parseRunSetupConfiguration(created.payload.configuration).ok;
}

export class ExportReplayService implements ReplayExportUseCases {
  constructor(private readonly source: ReplaySource) {}

  async export(input: {
    readonly context: EventProjectionContext;
    readonly observerMode: ObserverModeView;
  }): Promise<ReplayBundle> {
    try {
      const sourceEvents = this.source.listEvents(input.context.runId);
      if (sourceEvents.length === 0) {
        throw new ReplayExportError("RUN_NOT_FOUND", "Run was not found.");
      }
      const terminalState = terminal(sourceEvents);
      if (terminalState === undefined) {
        throw new ReplayExportError(
          "RUN_NOT_TERMINAL",
          "Replay export is available after completion or cancellation.",
        );
      }
      if (!hasPortableConfiguration(sourceEvents)) {
        throw new ReplayExportError(
          "REPLAY_INCOMPLETE",
          "The run has no portable Version 1 configuration.",
        );
      }
      const visibleEvents = sourceEvents.flatMap((event) => {
        const projected = projectEventForAudience(event, input.context);
        return projected === undefined ? [] : [projected];
      });
      const artifacts = await Promise.all(referencedDigests(visibleEvents).map(
        async (digest): Promise<ReplayArtifact> => {
          const artifact = await this.source.readArtifact({
            runId: input.context.runId,
            digest,
            audience: input.context.audience,
            revealState: input.context.revealState,
          });
          if (artifact === undefined) {
            throw new ReplayExportError(
              "REPLAY_INCOMPLETE",
              "An authorized replay artifact is unavailable.",
            );
          }
          return {
            digest: artifact.digest,
            byteCount: artifact.byteCount,
            mediaType: artifact.mediaType,
            redactedPreview: artifact.redactedPreview,
            visibility: artifact.visibility,
            contentEncoding: "base64",
            content: Buffer.from(artifact.bytes).toString("base64"),
          };
        },
      ));
      const bundle: ReplayBundle = {
        schemaVersion: REPLAY_BUNDLE_VERSION,
        projectorVersion: REPLAY_PROJECTOR_VERSION,
        runId: input.context.runId,
        terminal: terminalState,
        perspective: {
          mode: input.observerMode.mode,
          benchmarkEligible: input.observerMode.benchmarkEligible,
        },
        deliveries: deliveries(visibleEvents),
        artifacts,
      };
      if (!parseReplayBundle(bundle).ok) {
        throw new ReplayExportError(
          "REPLAY_INCOMPLETE",
          "The replay projection is internally inconsistent.",
        );
      }
      return bundle;
    } catch (error: unknown) {
      if (error instanceof ReplayExportError) throw error;
      throw new ReplayExportError(
        "REPLAY_SOURCE_UNAVAILABLE",
        "Replay source data is unavailable.",
        error,
      );
    }
  }
}
