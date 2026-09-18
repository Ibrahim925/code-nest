import type { DecodedEventDelivery } from "../../events/domain/live-events.js";
import type { ObserverModeState } from "../domain/modes.js";

export function projectObserverMode(
  state: ObserverModeState,
  delivery: DecodedEventDelivery,
): ObserverModeState {
  if (delivery.kind === "observer_unblinded") {
    return {
      ...state,
      mode: "unblinded",
      benchmarkEligible: false,
      unblindedEventId: state.unblindedEventId ?? delivery.eventId,
    };
  }
  if (delivery.kind === "match.roles_revealed") {
    return {
      ...state,
      mode: "post_match_reveal",
      revealedEventId: state.revealedEventId ?? delivery.eventId,
    };
  }
  return state;
}
