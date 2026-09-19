import {
  parseObservabilityEvent,
  type ObservabilityEvent,
} from "@code-nest/protocol";

import { ArtifactStore } from "../../artifacts/store.js";
import { EventLedger } from "../../ledger/ledger.js";
import {
  assertMatchingObservation,
  createObservationDraft,
  observationArtifact,
  sanitizeObservationRequest,
  type MemoryPosition,
  type ObservationEventOptions,
} from "./observability-event.js";
import type { ObservabilityStore } from "../application/ports/observability-store.js";
import {
  ObservabilityError,
  type ObservationReceipt,
  type RecordObservationRequest,
  type WorkingMemory,
} from "../domain/observation.js";

const PAGE_SIZE = 1_000;

export interface EventLedgerObservabilityStoreOptions
  extends ObservationEventOptions {
  readonly redactText: (value: string) => string;
}

function receipt(
  event: ObservabilityEvent,
  duplicate: boolean,
): ObservationReceipt {
  return {
    eventId: event.eventId,
    duplicate,
    eventKind: event.kind,
    artifactDigest: event.artifactDigests[0] ?? null,
  };
}

function storeError(message: string, error: unknown): ObservabilityError {
  return error instanceof ObservabilityError
    ? error
    : new ObservabilityError("OBSERVATION_STORE_FAILED", message, error);
}

export class EventLedgerObservabilityStore implements ObservabilityStore {
  constructor(
    private readonly ledger: EventLedger,
    private readonly artifacts: ArtifactStore,
    private readonly options: EventLedgerObservabilityStoreOptions,
  ) {}

  async record(request: RecordObservationRequest): Promise<ObservationReceipt> {
    try {
      const safeRequest = sanitizeObservationRequest(
        request,
        this.options.redactText,
      );
      const artifact = observationArtifact(safeRequest);
      const previous = this.ledger.getCommandResult(
        safeRequest.runId,
        safeRequest.observationId,
      );
      if (previous !== undefined) {
        return receipt(
          assertMatchingObservation(previous, safeRequest, artifact),
          true,
        );
      }
      if (this.ledger.listEvents(safeRequest.runId, { limit: 1 }).length === 0) {
        throw new ObservabilityError(
          "INVALID_OBSERVATION",
          "Observation belongs to an unknown run.",
        );
      }

      createObservationDraft(
        safeRequest,
        {
          createEventId: () => "observability-validation",
          now: () => new Date(0),
        },
        artifact,
        safeRequest.observation.kind === "memory"
          ? { revision: 1, previousDigest: null }
          : undefined,
      );

      const reference =
        artifact === undefined ? undefined : await this.artifacts.put(artifact.write);
      if (
        reference !== undefined &&
        (reference.digest !== artifact?.digest ||
          reference.byteCount !== artifact.byteCount)
      ) {
        throw new ObservabilityError(
          "OBSERVATION_STORE_FAILED",
          "Stored artifact identity did not match the observation.",
        );
      }
      const memory =
        safeRequest.observation.kind === "memory"
          ? this.nextMemoryPosition(safeRequest.runId, safeRequest.participantId)
          : undefined;
      const draft = createObservationDraft(
        safeRequest,
        this.options,
        artifact,
        memory,
      );
      const result = this.ledger.appendCommandEvent(
        safeRequest.observationId,
        draft,
      );
      const event = assertMatchingObservation(
        result.event,
        safeRequest,
        artifact,
      );
      return receipt(event, result.status === "duplicate");
    } catch (error: unknown) {
      throw storeError("Failed to record the observation.", error);
    }
  }

  async readLatestMemory(
    runId: string,
    participantId: string,
  ): Promise<WorkingMemory | undefined> {
    try {
      const event = this.latestMemoryEvent(runId, participantId);
      if (event === undefined) return undefined;
      const stored = await this.artifacts.read({
        runId,
        digest: event.payload.digest,
        audience: { kind: "participant", participantId },
        revealState: "sealed",
      });
      if (stored === undefined) {
        throw new ObservabilityError(
          "OBSERVATION_STORE_FAILED",
          "Working memory artifact is missing or unauthorized.",
        );
      }
      let content: string;
      try {
        content = new TextDecoder("utf-8", { fatal: true }).decode(stored.bytes);
      } catch (error: unknown) {
        throw new ObservabilityError(
          "OBSERVATION_STORE_FAILED",
          "Working memory artifact is not valid UTF-8.",
          error,
        );
      }
      return {
        participantId,
        memoryId: event.payload.memoryId,
        revision: event.payload.revision,
        summary: event.payload.summary,
        content,
        digest: event.payload.digest,
        previousDigest: event.payload.previousDigest,
      };
    } catch (error: unknown) {
      throw storeError("Failed to read working memory.", error);
    }
  }

  private nextMemoryPosition(
    runId: string,
    participantId: string,
  ): MemoryPosition {
    const previous = this.latestMemoryEvent(runId, participantId);
    return previous === undefined
      ? { revision: 1, previousDigest: null }
      : {
          revision: previous.payload.revision + 1,
          previousDigest: previous.payload.digest,
        };
  }

  private latestMemoryEvent(
    runId: string,
    participantId: string,
  ): Extract<ObservabilityEvent, { kind: "memory.updated" }> | undefined {
    let afterSequence = 0;
    let latest: Extract<ObservabilityEvent, { kind: "memory.updated" }> | undefined;
    while (true) {
      const events = this.ledger.listEvents(runId, {
        afterSequence,
        limit: PAGE_SIZE,
      });
      for (const event of events) {
        if (event.kind !== "memory.updated") continue;
        const parsed = assertMatchingMemoryEvent(event);
        if (parsed.payload.participantId === participantId) latest = parsed;
      }
      const last = events.at(-1);
      if (events.length < PAGE_SIZE || last === undefined) return latest;
      afterSequence = last.sequence;
    }
  }
}

function assertMatchingMemoryEvent(
  event: Parameters<typeof assertMatchingObservation>[0],
): Extract<ObservabilityEvent, { kind: "memory.updated" }> {
  const parsed = parseObservabilityEvent(event);
  if (!parsed.ok || parsed.value.kind !== "memory.updated") {
    throw new ObservabilityError(
      "OBSERVATION_STORE_FAILED",
      "Stored working memory event failed validation.",
      parsed.ok ? undefined : parsed.error,
    );
  }
  return parsed.value;
}
