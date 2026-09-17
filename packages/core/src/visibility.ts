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

export type Visibility = EventEnvelope["visibility"];

export interface VisibilityContext {
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

  return canAudienceViewVisibility(event.visibility, context) ? event : undefined;
}

export function canAudienceViewVisibility(
  visibility: Visibility,
  context: VisibilityContext,
): boolean {
  if (context.audience.kind === "operator") return true;

  switch (visibility.class) {
    case "public":
      return true;
    case "operator_private":
      return false;
    case "post_reveal":
      return (
        context.revealState === "revealed" ||
        isUnblindedObserver(context.audience)
      );
    case "participant_private":
    case "covert":
      return (
        context.revealState === "revealed" ||
        isUnblindedObserver(context.audience) ||
        isTargetParticipant(context.audience, visibility.recipientIds)
      );
  }
}
