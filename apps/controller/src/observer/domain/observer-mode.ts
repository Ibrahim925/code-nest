import type { EventEnvelope } from "@code-nest/protocol";

export type ObserverMode = "clean" | "unblinded" | "post_match_reveal";

export interface ObserverModeView {
  readonly schemaVersion: "1.0";
  readonly runId: string;
  readonly mode: ObserverMode;
  readonly benchmarkEligible: boolean;
  readonly unblindedEventId: string | null;
  readonly revealedEventId: string | null;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function configuredUnblinded(event: EventEnvelope): boolean {
  if (event.kind !== "run.created") return false;
  const payload = record(event.payload);
  const configuration = record(payload?.configuration);
  return configuration?.disclosurePolicy === "researcher-unblinded";
}

export function projectObserverMode(
  runId: string,
  events: readonly EventEnvelope[],
): ObserverModeView | undefined {
  if (events.length === 0) return undefined;
  let unblindedEventId: string | null = null;
  let revealedEventId: string | null = null;
  for (const event of events) {
    if (event.runId !== runId) continue;
    if (event.kind === "observer_unblinded" || configuredUnblinded(event)) {
      unblindedEventId ??= event.eventId;
    }
    if (event.kind === "match.roles_revealed") revealedEventId ??= event.eventId;
  }
  const mode = revealedEventId !== null
    ? "post_match_reveal"
    : unblindedEventId !== null ? "unblinded" : "clean";
  return {
    schemaVersion: "1.0",
    runId,
    mode,
    benchmarkEligible: unblindedEventId === null,
    unblindedEventId,
    revealedEventId,
  };
}
