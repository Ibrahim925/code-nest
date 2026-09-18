import type { RecoveryOutcome } from "../../domain/recovery-outcome.js";

export interface RecoveryReceipt {
  readonly eventId: string;
  readonly duplicate: boolean;
  readonly outcome: RecoveryOutcome;
}

export interface RecoveryJournal {
  record(request: {
    readonly runId: string;
    readonly commandId: string;
    readonly outcome: RecoveryOutcome;
  }): Promise<RecoveryReceipt>;
}
