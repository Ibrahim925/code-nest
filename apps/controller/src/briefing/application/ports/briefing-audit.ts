import type { BriefingReceipt } from "../../domain/brief.js";

export type BriefingAttemptStatus =
  | { readonly status: "started" }
  | { readonly status: "already_started" };

export interface BriefingAudit {
  beginAttempt(receipt: BriefingReceipt): Promise<BriefingAttemptStatus>;
  complete(receipt: BriefingReceipt): Promise<void>;
}
