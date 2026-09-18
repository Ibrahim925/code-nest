import { EVENT_SCHEMA_VERSION } from "@code-nest/protocol";

import { EventLedger, type EventDraft } from "../../ledger/ledger.js";
import type {
  OneRoundEvidence,
  OneRoundEvidenceRecorder,
} from "../application/ports/one-round-match-ports.js";

export interface EventLedgerOneRoundEvidenceOptions {
  readonly createEventId: () => string;
  readonly now: () => Date;
}

interface EventFields {
  readonly commandId: string;
  readonly kind: string;
  readonly phase: "work" | "integration";
  readonly payload: EventDraft["payload"];
  readonly artifactDigests: readonly `sha256:${string}`[];
}

function fields(evidence: OneRoundEvidence): EventFields {
  switch (evidence.type) {
    case "workspaces_ready":
      return {
        commandId: "match-workspaces-ready",
        kind: "match.workspaces_ready",
        phase: "work",
        payload: {
          participantIds: [...evidence.participantIds],
          baseRevision: evidence.baseRevision,
        },
        artifactDigests: [],
      };
    case "runtime_started":
      return {
        commandId: `runtime-start-${evidence.participantId}`,
        kind: "runtime.started",
        phase: "work",
        payload: {
          participantId: evidence.participantId,
          sessionId: evidence.sessionId,
          descriptor: { ...evidence.descriptor },
        },
        artifactDigests: [],
      };
    case "runtime_stopped":
      return {
        commandId: `runtime-stop-${evidence.participantId}`,
        kind: "runtime.stopped",
        phase: "work",
        payload: {
          participantId: evidence.participantId,
          turnsCompleted: evidence.turnsCompleted,
        },
        artifactDigests: [],
      };
    case "work_captured":
      return {
        commandId: `work-capture-${evidence.participantId}`,
        kind: "participant.work_captured",
        phase: "work",
        payload: {
          participantId: evidence.participantId,
          turn: {
            ...evidence.turn,
            publicMessages: [...evidence.turn.publicMessages],
            usage: evidence.turn.usage === null ? null : { ...evidence.turn.usage },
          },
        },
        artifactDigests: [],
      };
    case "integration_completed":
      return {
        commandId: "match-integration-complete",
        kind: "integration.completed",
        phase: "integration",
        payload: {
          report: {
            ...evidence.report,
            outcomes: evidence.report.outcomes.map((outcome) => ({ ...outcome })),
          },
        },
        artifactDigests: [evidence.reportDigest],
      };
    case "match_completed":
      return {
        commandId: "match-complete",
        kind: "match.completed",
        phase: "integration",
        payload: { candidateRevision: evidence.candidateRevision },
        artifactDigests: [],
      };
  }
}

export class EventLedgerOneRoundEvidence implements OneRoundEvidenceRecorder {
  constructor(
    private readonly ledger: EventLedger,
    private readonly options: EventLedgerOneRoundEvidenceOptions,
  ) {}

  async record(runId: string, evidence: OneRoundEvidence): Promise<void> {
    const event = fields(evidence);
    const draft: EventDraft = {
      schemaVersion: EVENT_SCHEMA_VERSION,
      eventId: this.options.createEventId(),
      runId,
      recordedAt: this.options.now().toISOString(),
      actor: { kind: "controller", id: "one-round-match" },
      context: { round: 1, phase: event.phase },
      kind: event.kind,
      payload: event.payload,
      visibility: { class: "public" },
      causationId: event.commandId,
      correlationId: runId,
      parentEventIds: [],
      artifactDigests: [...event.artifactDigests],
      resourceCost: {},
    };
    this.ledger.appendCommandEvent(event.commandId, draft);
  }
}
