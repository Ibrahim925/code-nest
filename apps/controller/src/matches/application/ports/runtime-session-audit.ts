import type { MatchRuntimeDescriptor } from "./one-round-match-ports.js";

export interface RuntimeSessionEvidence {
  readonly round: number;
  readonly participantId: string;
  readonly sessionId: string;
  readonly descriptor: MatchRuntimeDescriptor;
}

export interface RuntimeSessionAudit {
  record(runId: string, evidence: RuntimeSessionEvidence): Promise<void>;
}
