import type { PrivateBeliefReport } from "@code-nest/core";

export interface BeliefSubmissionContext {
  readonly round: number;
  readonly phase: string;
  readonly activeParticipantIds: readonly string[];
}

export interface BeliefContextReader {
  read(runId: string): BeliefSubmissionContext | undefined;
}

export interface BeliefEvidenceReader {
  isVisible(input: {
    readonly runId: string;
    readonly round: number;
    readonly participantId: string;
    readonly eventId: string;
  }): boolean;
}

export interface BeliefReceipt {
  readonly status: "accepted" | "duplicate";
  readonly eventId: string;
  readonly report: PrivateBeliefReport;
}

export interface BeliefJournal {
  find(runId: string, commandId: string): BeliefReceipt | undefined;
  record(runId: string, commandId: string, report: PrivateBeliefReport): BeliefReceipt;
}
