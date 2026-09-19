import {
  parseObservabilityEvent,
  type ObservabilityEvent,
} from "@code-nest/protocol";

import type { DecodedEventDelivery } from "../../events/domain/live-events.js";
import type {
  AgentObservatoryState,
  ObservatoryAgent,
  ObservatoryAgentSeed,
  ObservatoryComputer,
  ObservatoryFrame,
} from "../domain/agent-observatory.js";
import { sanitizeUntrustedText } from "./sanitize-untrusted-text.js";
import {
  observatoryDiscourseItem,
  observatoryTimelineItem,
} from "./project-agent-observatory-items.js";

type RuntimeEvent = Extract<
  ObservabilityEvent,
  {
    kind:
      | "runtime.activity_reported"
      | "runtime.rationale_submitted"
      | "runtime.tool_observed"
      | "runtime.computer_frame_captured"
      | "memory.updated";
  }
>;

function observableEvent(
  delivery: DecodedEventDelivery,
): ObservabilityEvent | null {
  if (
    typeof delivery.event !== "object" ||
    delivery.event === null ||
    Array.isArray(delivery.event)
  ) {
    return null;
  }
  const parsed = parseObservabilityEvent({
    ...(delivery.event as Record<string, unknown>),
    sequence: 1,
  });
  return parsed.ok ? parsed.value : null;
}

function initialComputer(): ObservatoryComputer {
  return {
    status: "awaiting",
    freshness: "current",
    label: "Awaiting first computer frame",
    frame: null,
    lastVisibleFrame: null,
    withheldReason: null,
    eventId: null,
  };
}

export function createAgentObservatoryState(
  participants: readonly ObservatoryAgentSeed[],
): AgentObservatoryState {
  if (
    participants.length !== 4 ||
    new Set(participants.map(({ participantId }) => participantId)).size !== 4
  ) {
    throw new Error(
      "The agent Observatory requires exactly four unique participants.",
    );
  }
  return {
    agents: participants.map((participant, index) => ({
      ...participant,
      slot: index + 1,
      activity: {
        availability: "awaiting",
        state: null,
        summary: "Awaiting first activity report",
        provenance: null,
        eventId: null,
        deliverySequence: null,
      },
      computer: initialComputer(),
      rationale: null,
      memory: null,
      latestTool: null,
    })),
    phase: {
      round: null,
      name: null,
      eventId: null,
      transitionCount: 0,
    },
    discourse: [],
    timeline: [],
    lastDeliverySequence: 0,
  };
}

function updateAgent(
  agents: readonly ObservatoryAgent[],
  participantId: string,
  update: (agent: ObservatoryAgent) => ObservatoryAgent,
): readonly ObservatoryAgent[] {
  if (!agents.some((agent) => agent.participantId === participantId)) {
    return agents;
  }
  return agents.map((agent) =>
    agent.participantId === participantId ? update(agent) : agent,
  );
}

function staleComputer(computer: ObservatoryComputer): ObservatoryComputer {
  return computer.status === "awaiting" || computer.status === "disconnected"
    ? computer
    : { ...computer, freshness: "stale" };
}

function runtimeParticipant(event: RuntimeEvent): string {
  return event.kind === "memory.updated" ||
    event.kind === "runtime.activity_reported" ||
    event.kind === "runtime.rationale_submitted" ||
    event.kind === "runtime.tool_observed" ||
    event.kind === "runtime.computer_frame_captured"
    ? event.payload.participantId
    : "";
}

function frame(
  event: Extract<RuntimeEvent, { kind: "runtime.computer_frame_captured" }>,
): ObservatoryFrame | null {
  const payload = event.payload;
  if (payload.digest === null) return null;
  return {
    frameId: payload.frameId,
    digest: payload.digest as `sha256:${string}`,
    width: payload.width,
    height: payload.height,
    byteCount: payload.byteCount,
    captureReason: payload.captureReason,
    frameSequence: payload.frameSequence,
    eventId: event.eventId,
  };
}

function applyRuntimeEvent(
  agent: ObservatoryAgent,
  event: RuntimeEvent,
  deliverySequence: number,
): ObservatoryAgent {
  switch (event.kind) {
    case "runtime.activity_reported": {
      const disconnected =
        event.payload.state === "failed" || event.payload.state === "stopped";
      return {
        ...agent,
        activity: {
          availability: "reported",
          state: event.payload.state,
          summary: event.payload.summary,
          provenance: event.payload.provenance,
          eventId: event.eventId,
          deliverySequence,
        },
        computer: disconnected
          ? {
              ...agent.computer,
              status: "disconnected",
              freshness: "stale",
              label: "Computer disconnected",
              eventId: event.eventId,
            }
          : staleComputer(agent.computer),
      };
    }
    case "runtime.rationale_submitted": {
      const body = sanitizeUntrustedText(event.payload.body, 2_000);
      if (body === null) return agent;
      const attribution =
        event.payload.provenance === "agent_submitted"
          ? "Submitted by agent"
          : `${event.payload.provider} · ${event.payload.model}`;
      return {
        ...agent,
        rationale: {
          body: body.text,
          provenance: event.payload.provenance,
          attribution,
          eventId: event.eventId,
        },
      };
    }
    case "runtime.tool_observed":
      return {
        ...agent,
        computer: staleComputer(agent.computer),
        latestTool: {
          toolCallId: event.payload.toolCallId,
          toolName: event.payload.toolName,
          status: event.payload.status,
          summary: event.payload.summary,
          eventId: event.eventId,
        },
      };
    case "runtime.computer_frame_captured": {
      const current = frame(event);
      if (current === null) {
        return {
          ...agent,
          computer: {
            status: "withheld",
            freshness: "current",
            label: `Frame withheld · ${event.payload.withheldReason?.replaceAll("_", " ")}`,
            frame: null,
            lastVisibleFrame: agent.computer.lastVisibleFrame,
            withheldReason: event.payload.withheldReason,
            eventId: event.eventId,
          },
        };
      }
      const status =
        event.payload.redactionStatus === "redacted" ? "redacted" : "visible";
      return {
        ...agent,
        computer: {
          status,
          freshness: "current",
          label: status === "redacted" ? "Redacted computer frame" : "Live computer frame",
          frame: current,
          lastVisibleFrame: current,
          withheldReason: null,
          eventId: event.eventId,
        },
      };
    }
    case "memory.updated":
      return {
        ...agent,
        memory: {
          memoryId: event.payload.memoryId,
          revision: event.payload.revision,
          reason: event.payload.reason,
          summary: event.payload.summary,
          digest: event.payload.digest as `sha256:${string}`,
          previousDigest: event.payload.previousDigest as `sha256:${string}` | null,
          eventId: event.eventId,
        },
      };
  }
}

export function projectAgentObservatory(
  state: AgentObservatoryState,
  delivery: DecodedEventDelivery,
): AgentObservatoryState {
  if (delivery.deliverySequence <= state.lastDeliverySequence) return state;
  const event = observableEvent(delivery);
  if (event === null) {
    return { ...state, lastDeliverySequence: delivery.deliverySequence };
  }
  let agents = state.agents;
  if (
    event.kind === "runtime.activity_reported" ||
    event.kind === "runtime.rationale_submitted" ||
    event.kind === "runtime.tool_observed" ||
    event.kind === "runtime.computer_frame_captured" ||
    event.kind === "memory.updated"
  ) {
    agents = updateAgent(agents, runtimeParticipant(event), (agent) =>
      applyRuntimeEvent(agent, event, delivery.deliverySequence),
    );
  }
  const discussion = observatoryDiscourseItem(
    event,
    delivery.deliverySequence,
  );
  const phase =
    event.kind === "match.phase_advanced"
      ? {
          round: event.payload.to.round,
          name: event.payload.to.phase,
          eventId: event.eventId,
          transitionCount: state.phase.transitionCount + 1,
        }
      : state.phase;
  return {
    agents,
    phase,
    discourse:
      discussion === null ? state.discourse : [...state.discourse, discussion],
    timeline: [
      ...state.timeline,
      observatoryTimelineItem(event, delivery.deliverySequence),
    ],
    lastDeliverySequence: delivery.deliverySequence,
  };
}
