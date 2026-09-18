import {
  createPrivateBeliefReport,
  sameBeliefSubmission,
  type BeliefReportSubmission,
} from "@code-nest/core";

import type {
  BeliefContextReader,
  BeliefEvidenceReader,
  BeliefJournal,
  BeliefReceipt,
} from "./ports/belief-ports.js";

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export class BeliefApplicationError extends Error {
  constructor(
    readonly code:
      | "BELIEF_COMMAND_CONFLICT"
      | "BELIEF_EVIDENCE_UNAVAILABLE"
      | "BELIEF_STORAGE_FAILED"
      | "BELIEF_SUBMISSION_UNAUTHORIZED"
      | "INVALID_BELIEF_SUBMISSION",
    message: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "BeliefApplicationError";
  }
}

export interface SubmitPrivateBeliefRequest extends BeliefReportSubmission {
  readonly runId: string;
  readonly commandId: string;
}

export interface BeliefServiceDependencies {
  readonly contexts: BeliefContextReader;
  readonly evidence: BeliefEvidenceReader;
  readonly journal: BeliefJournal;
}

function submission(request: SubmitPrivateBeliefRequest): BeliefReportSubmission {
  return {
    participantId: request.participantId,
    round: request.round,
    allocations: request.allocations,
    strongestEvidenceEventId: request.strongestEvidenceEventId,
  };
}

export class BeliefService {
  constructor(private readonly dependencies: BeliefServiceDependencies) {}

  submit(request: SubmitPrivateBeliefRequest): BeliefReceipt {
    if (!IDENTIFIER_PATTERN.test(request.runId) || !IDENTIFIER_PATTERN.test(request.commandId)) {
      throw new BeliefApplicationError(
        "INVALID_BELIEF_SUBMISSION",
        "Belief submission run and command IDs must be portable identifiers.",
      );
    }
    const requested = submission(request);
    const previous = this.dependencies.journal.find(request.runId, request.commandId);
    if (previous !== undefined) {
      if (!sameBeliefSubmission(previous.report, requested)) {
        throw new BeliefApplicationError(
          "BELIEF_COMMAND_CONFLICT",
          "Belief command ID was already used for another submission.",
        );
      }
      return { ...previous, status: "duplicate" };
    }

    const context = this.dependencies.contexts.read(request.runId);
    if (
      context === undefined || context.phase !== "belief" ||
      context.round !== request.round ||
      !context.activeParticipantIds.includes(request.participantId)
    ) {
      throw new BeliefApplicationError(
        "BELIEF_SUBMISSION_UNAUTHORIZED",
        "Belief submission is unavailable for this participant and phase.",
      );
    }
    const report = createPrivateBeliefReport(context.activeParticipantIds, requested);
    if (!this.dependencies.evidence.isVisible({
      runId: request.runId,
      round: request.round,
      participantId: request.participantId,
      eventId: request.strongestEvidenceEventId,
    })) {
      throw new BeliefApplicationError(
        "BELIEF_EVIDENCE_UNAVAILABLE",
        "Cited belief evidence is not available to this participant.",
      );
    }
    return this.dependencies.journal.record(request.runId, request.commandId, report);
  }
}
