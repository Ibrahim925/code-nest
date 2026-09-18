import type { DisclosurePolicy } from "../../run-setup/domain.js";

export type ObserverMode = "clean" | "unblinded" | "post_match_reveal";

export interface ObserverModeState {
  readonly schemaVersion: "1.0";
  readonly runId: string;
  readonly mode: ObserverMode;
  readonly benchmarkEligible: boolean;
  readonly unblindedEventId: string | null;
  readonly revealedEventId: string | null;
}

export function initialObserverMode(
  runId: string,
  disclosurePolicy: DisclosurePolicy,
): ObserverModeState {
  const unblinded = disclosurePolicy === "researcher-unblinded";
  return {
    schemaVersion: "1.0",
    runId,
    mode: unblinded ? "unblinded" : "clean",
    benchmarkEligible: !unblinded,
    unblindedEventId: null,
    revealedEventId: null,
  };
}
