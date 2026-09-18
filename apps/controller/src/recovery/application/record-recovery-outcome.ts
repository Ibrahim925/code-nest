import type { RecoveryJournal, RecoveryReceipt } from "./ports/recovery-journal.js";
import {
  classifyRecoverySignal,
  RecoveryOutcomeError,
  type RecoverySignal,
} from "../domain/recovery-outcome.js";

export interface RecordRecoveryRequest {
  readonly runId: string;
  readonly commandId: string;
  readonly signal: RecoverySignal;
}

const IDENTIFIER = /^[a-z0-9][a-z0-9._-]{0,127}$/;

export class RecordRecoveryOutcomeService {
  constructor(private readonly journal: RecoveryJournal) {}

  record(request: RecordRecoveryRequest): Promise<RecoveryReceipt> {
    if (!IDENTIFIER.test(request.runId) || !IDENTIFIER.test(request.commandId)) {
      throw new RecoveryOutcomeError("Recovery run or command identity is invalid.");
    }
    return this.journal.record({
      runId: request.runId,
      commandId: request.commandId,
      outcome: classifyRecoverySignal(request.signal),
    });
  }
}
