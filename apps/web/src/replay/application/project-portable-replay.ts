import { projectReplay, type ReplayProjection } from "@code-nest/core";
import type { ReplayBundle } from "@code-nest/protocol";

import type { DecodedEventDelivery } from "../../events/domain/live-events.js";
import {
  createActivityFeedState,
  projectActivityFeed,
} from "../../observatory/application/project-activity-feed.js";
import {
  createAgentLaneState,
  projectAgentLanes,
} from "../../observatory/application/project-agent-lanes.js";
import type { ActivityFeedState } from "../../observatory/domain/activity-feed.js";
import type { AgentLaneState } from "../../observatory/domain/agent-lane.js";
import { projectTownHall } from "../../town-hall/application/project-town-hall.js";
import {
  createTownHallViewState,
  type TownHallViewState,
} from "../../town-hall/domain/town-hall.js";

export interface PortableReplayView {
  readonly analysis: ReplayProjection;
  readonly lanes: AgentLaneState;
  readonly activity: ActivityFeedState;
  readonly townHall: TownHallViewState;
}

function decoded(bundle: ReplayBundle, through: number): DecodedEventDelivery[] {
  return bundle.deliveries.slice(0, through).map((delivery) => ({
    deliverySequence: delivery.deliverySequence,
    eventId: delivery.event.eventId,
    kind: delivery.event.kind,
    event: delivery.event,
  }));
}

export function projectPortableReplay(
  bundle: ReplayBundle,
  throughDeliverySequence = bundle.deliveries.length,
): PortableReplayView {
  const analysis = projectReplay(bundle, throughDeliverySequence);
  if (analysis.configuration === null) {
    throw new Error("Replay bundle has no valid configured run manifest.");
  }
  let lanes = createAgentLaneState(analysis.configuration.adapters);
  let activity = createActivityFeedState();
  let townHall = createTownHallViewState();
  for (const delivery of decoded(bundle, throughDeliverySequence)) {
    lanes = projectAgentLanes(lanes, delivery);
    activity = projectActivityFeed(activity, delivery);
    townHall = projectTownHall(townHall, delivery);
  }
  return { analysis, lanes, activity, townHall };
}
