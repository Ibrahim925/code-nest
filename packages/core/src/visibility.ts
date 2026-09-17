import type { EventEnvelope } from "@code-nest/protocol";

export type RevealState = "sealed" | "revealed";

export type EventAudience =
  | { kind: "participant"; participantId: string }
  | { kind: "observer"; mode: "clean" | "unblinded" }
  | { kind: "operator" };

export interface EventProjectionContext {
  runId: string;
  revealState: RevealState;
  audience: EventAudience;
}

function isUnblindedObserver(audience: EventAudience): boolean {
  return audience.kind === "observer" && audience.mode === "unblinded";
}

function isTargetParticipant(
  audience: EventAudience,
  recipientIds: readonly string[],
): boolean {
  return (
    audience.kind === "participant" &&
    recipientIds.includes(audience.participantId)
  );
}

export function projectEventForAudience(
  event: EventEnvelope,
  context: EventProjectionContext,
): EventEnvelope | undefined {
  if (event.runId !== context.runId) return undefined;
  if (context.audience.kind === "operator") return event;

  switch (event.visibility.class) {
    case "public":
      return event;
    case "operator_private":
      return undefined;
    case "post_reveal":
      return context.revealState === "revealed" ||
        isUnblindedObserver(context.audience)
        ? event
        : undefined;
    case "participant_private":
    case "covert":
      return context.revealState === "revealed" ||
        isUnblindedObserver(context.audience) ||
        isTargetParticipant(context.audience, event.visibility.recipientIds)
        ? event
        : undefined;
  }
}
