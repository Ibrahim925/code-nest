import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type {
  ArtifactEvidence,
  ArtifactEvidenceClient,
} from "../evidence/domain/artifact-evidence.js";
import { DEFAULT_RUN_SETUP } from "../run-setup/catalog.js";
import { AgentMemory, readableMemory } from "./AgentMemory.js";
import { AgentObservatory } from "./AgentObservatory.js";
import { ObservatoryDiscourse } from "./ObservatoryDiscourse.js";
import { createAgentLaneState } from "./application/project-agent-lanes.js";
import { createAgentObservatoryState } from "./application/project-agent-observatory.js";
import type { AgentObservatoryState } from "./domain/agent-observatory.js";

const digest = `sha256:${"a".repeat(64)}` as const;

class FixtureArtifactClient implements ArtifactEvidenceClient {
  async load(): Promise<ArtifactEvidence> {
    return {
      digest,
      byteCount: 5,
      mediaType: "text/plain",
      visibility: "participant_private",
      redactedPreview: "",
      bytes: new TextEncoder().encode("notes"),
    };
  }
}

function populatedState(): AgentObservatoryState {
  const initial = createAgentObservatoryState(DEFAULT_RUN_SETUP.adapters);
  const first = initial.agents[0];
  if (first === undefined) throw new Error("Expected first participant");
  return {
    ...initial,
    phase: {
      round: 2,
      name: "town_hall",
      eventId: "phase-2",
      transitionCount: 4,
    },
    agents: [
      {
        ...first,
        activity: {
          availability: "reported",
          state: "testing",
          summary: "Running the isolated verification suite.",
          provenance: "runtime_observed",
          eventId: "activity-1",
          deliverySequence: 8,
        },
        computer: {
          status: "redacted",
          freshness: "stale",
          label: "Redacted computer frame",
          frame: {
            frameId: "frame-1",
            digest,
            width: 1280,
            height: 720,
            byteCount: 400,
            captureReason: "action",
            frameSequence: 3,
            eventId: "frame-event-1",
          },
          lastVisibleFrame: null,
          withheldReason: null,
          eventId: "frame-event-1",
        },
        rationale: {
          body: "The focused tests now pass; I am checking the integration boundary.",
          provenance: "provider_reasoning_summary",
          attribution: "OpenAI · Luna",
          eventId: "rationale-1",
        },
        memory: {
          memoryId: "memory-a",
          revision: 3,
          reason: "round_transition",
          summary: "Saved the verified handoff and unresolved interface risk.",
          digest,
          previousDigest: null,
          eventId: "memory-1",
        },
        latestTool: {
          toolCallId: "tool-1",
          toolName: "test",
          status: "completed",
          summary: "Focused suite passed",
          eventId: "tool-event-1",
        },
      },
      ...initial.agents.slice(1),
    ],
    discourse: [{
      id: "message-1",
      eventId: "message-1",
      participantId: first.participantId,
      channel: "town_hall",
      body: "The boundary is ready for review.",
      yielded: false,
      deliverySequence: 9,
    }],
    timeline: [{
      eventId: "phase-2",
      deliverySequence: 9,
      participantId: null,
      kind: "match.phase_advanced",
      label: "Phase advanced to town hall",
    }],
    lastDeliverySequence: 9,
  };
}

describe("four-agent live Observatory interface", () => {
  it("renders four fixed computer views and honest initial states", () => {
    const state = createAgentObservatoryState(DEFAULT_RUN_SETUP.adapters);
    const markup = renderToStaticMarkup(
      <AgentObservatory
        runId="run-1"
        state={state}
        laneState={createAgentLaneState(DEFAULT_RUN_SETUP.adapters)}
        artifactClient={new FixtureArtifactClient()}
      />,
    );
    expect(markup.match(/class="agent-computer agent-lane"/g)).toHaveLength(4);
    expect(markup).toContain("Four participant computers");
    expect(markup.match(/Awaiting first computer frame/g)).toHaveLength(8);
    expect(markup).toContain("Only authorized human-view facts are shown");
    expect(markup).toContain("Private reasoning is never projected");
    expect(markup).not.toContain("chain of thought");
  });

  it("makes phase, discourse, rationale, screen state, tools, and memory visible", () => {
    const markup = renderToStaticMarkup(
      <AgentObservatory
        runId="run-1"
        state={populatedState()}
        laneState={createAgentLaneState(DEFAULT_RUN_SETUP.adapters)}
        artifactClient={new FixtureArtifactClient()}
      />,
    );
    expect(markup).toContain("Current phase: town hall");
    expect(markup).toContain("4 phase transitions");
    expect(markup).toContain("Redacted computer frame");
    expect(markup).toContain("Earlier frame");
    expect(markup).toContain("OpenAI · Luna");
    expect(markup).toContain("The focused tests now pass");
    expect(markup).toContain("test · completed");
    expect(markup).toContain("Revision 3");
    expect(markup).toContain("Read verified memory");
    expect(markup).toContain("The boundary is ready for review");
  });

  it("renders a bounded 80-row human timeline", () => {
    const timeline = Array.from({ length: 100 }, (_, index) => ({
      eventId: `event-${index}`,
      deliverySequence: index + 1,
      participantId: null,
      kind: "runtime.activity_reported",
      label: `Visible event ${index}`,
    }));
    const markup = renderToStaticMarkup(
      <ObservatoryDiscourse discourse={[]} timeline={timeline} />,
    );
    expect(markup.match(/Visible event /g)).toHaveLength(80);
    expect(markup).not.toContain("Visible event 19<");
    expect(markup).toContain("Visible event 20");
    expect(markup).toContain("100 events");
  });

  it("sanitizes readable memory and labels memory controls by participant", () => {
    expect(readableMemory(new TextEncoder().encode("line\u001b[31m red"))).toBe("line red");
    expect(readableMemory(Uint8Array.from([255]))).toBeNull();
    const memory = populatedState().agents[0]?.memory ?? null;
    const markup = renderToStaticMarkup(
      <AgentMemory
        runId="run-1"
        participantId="participant-a"
        memory={memory}
        artifactClient={new FixtureArtifactClient()}
      />,
    );
    expect(markup).toContain("Read verified memory");
    expect(markup).toContain("Saved the verified handoff");
  });
});
