import type {
  ArtifactEvidence,
  ArtifactEvidenceClient,
} from "../evidence/domain/artifact-evidence.js";
import { DEFAULT_RUN_SETUP } from "../run-setup/catalog.js";
import { AgentObservatory } from "./AgentObservatory.js";
import { createAgentLaneState } from "./application/project-agent-lanes.js";
import { createAgentObservatoryState } from "./application/project-agent-observatory.js";
import type { AgentObservatoryState } from "./domain/agent-observatory.js";

const frameFallbackDigest = `sha256:${"a".repeat(64)}` as const;
const memoryFallbackDigest = `sha256:${"e".repeat(64)}` as const;
const digests = ["a", "b", "c", "d"].map(
  (value) => `sha256:${value.repeat(64)}` as `sha256:${string}`,
);
const memoryDigests = ["e", "f", "0", "1"].map(
  (value) => `sha256:${value.repeat(64)}` as `sha256:${string}`,
);

const onePixelPng = Uint8Array.from([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82,
  0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137,
  0, 0, 0, 13, 73, 68, 65, 84, 8, 215, 99, 96, 96, 248, 15, 0,
  1, 4, 1, 0, 95, 232, 199, 219, 0, 0, 0, 0, 73, 69, 78, 68,
  174, 66, 96, 130,
]);

class PreviewArtifactClient implements ArtifactEvidenceClient {
  async load(request: { readonly digest: `sha256:${string}` }): Promise<ArtifactEvidence> {
    const isFrame = digests.includes(request.digest);
    const bytes = isFrame
      ? onePixelPng
      : new TextEncoder().encode("Verified synthetic memory preview.\nNext: preserve replay parity and re-run the focused checks.");
    return {
      digest: request.digest,
      byteCount: bytes.byteLength,
      mediaType: isFrame ? "image/png" : "text/plain",
      visibility: "participant_private",
      redactedPreview: "",
      bytes,
    };
  }
}

function previewState(): AgentObservatoryState {
  const initial = createAgentObservatoryState(DEFAULT_RUN_SETUP.adapters.map(
    (adapter, index) => ({
      ...adapter,
      adapterId: "omp",
      executionMode: "contained" as const,
      modelDisclosure: `OpenAI Luna · seat ${index + 1}`,
    }),
  ));
  return {
    ...initial,
    phase: { round: 1, name: "town_hall", eventId: "phase-7", transitionCount: 3 },
    agents: initial.agents.map((agent, index) => ({
      ...agent,
      activity: {
        availability: "reported" as const,
        state: (["testing", "waiting", "town_hall", "working"] as const)[index] ?? "working",
        summary: [
          "Running focused access-policy tests.",
          "Reviewing the integration candidate before voting.",
          "Presenting evidence to the Town Hall.",
          "Reconciling the shared branch with the latest approved patch.",
        ][index] ?? "Working on the assigned task.",
        provenance: "runtime_observed" as const,
        eventId: `activity-${index}`,
        deliverySequence: 20 + index,
      },
      computer: index < 2 ? {
        status: index === 0 ? "visible" as const : "redacted" as const,
        freshness: index === 0 ? "current" as const : "stale" as const,
        label: index === 0 ? "Live computer frame" : "Redacted computer frame",
        frame: {
          frameId: `frame-${index}`,
          digest: digests[index] ?? frameFallbackDigest,
          width: 1280,
          height: 720,
          byteCount: onePixelPng.byteLength,
          captureReason: "action" as const,
          frameSequence: index + 4,
          eventId: `frame-event-${index}`,
        },
        lastVisibleFrame: null,
        withheldReason: null,
        eventId: `frame-event-${index}`,
      } : index === 2 ? {
        status: "withheld" as const,
        freshness: "current" as const,
        label: "Frame withheld · suspected secret",
        frame: null,
        lastVisibleFrame: null,
        withheldReason: "suspected_secret" as const,
        eventId: "frame-event-2",
      } : {
        status: "disconnected" as const,
        freshness: "stale" as const,
        label: "Computer disconnected",
        frame: null,
        lastVisibleFrame: null,
        withheldReason: null,
        eventId: "activity-3",
      },
      rationale: {
        body: [
          "The policy test now passes; I am checking the failure boundary.",
          "The candidate is small and preserves the controller-owned Git path.",
          "I can support the motion with the cited test and commit evidence.",
          "The rebase is clean; the remaining risk is limited to replay parity.",
        ][index] ?? "No summary supplied.",
        provenance: "provider_reasoning_summary" as const,
        attribution: "OpenAI · Luna",
        eventId: `rationale-${index}`,
      },
      memory: {
        memoryId: `memory-${index}`,
        revision: index + 2,
        reason: index === 2 ? "round_transition" as const : "agent_consolidation" as const,
        summary: "Saved the verified handoff, current evidence, and next action.",
        digest: memoryDigests[index] ?? memoryFallbackDigest,
        previousDigest: null,
        eventId: `memory-event-${index}`,
      },
      latestTool: {
        toolCallId: `tool-${index}`,
        toolName: ["test", "git diff", "town-hall", "git rebase"][index] ?? "tool",
        status: index === 3 ? "started" as const : "completed" as const,
        summary: "Bounded observable tool fact",
        eventId: `tool-event-${index}`,
      },
    })),
    discourse: [
      { id: "d1", eventId: "d1", participantId: "player-c", channel: "town_hall", body: "The focused policy test passes at commit 8e42.", yielded: false, deliverySequence: 25 },
      { id: "d2", eventId: "d2", participantId: "player-a", channel: "town_hall", body: "I reviewed that evidence and support integration.", yielded: false, deliverySequence: 26 },
      { id: "d3", eventId: "d3", participantId: "player-b", channel: "town_hall", body: null, yielded: true, deliverySequence: 27 },
    ],
    timeline: [
      { eventId: "p1", deliverySequence: 24, participantId: null, kind: "match.phase_advanced", label: "Town Hall started" },
      { eventId: "d1", deliverySequence: 25, participantId: "player-c", kind: "town_hall.turn_recorded", label: "Town Hall statement" },
      { eventId: "d2", deliverySequence: 26, participantId: "player-a", kind: "town_hall.turn_recorded", label: "Town Hall statement" },
      { eventId: "d3", deliverySequence: 27, participantId: "player-b", kind: "town_hall.turn_recorded", label: "Town Hall yield" },
    ],
    lastDeliverySequence: 27,
  };
}

export function ObservatoryPreview(): React.JSX.Element {
  const state = previewState();
  const laneState = createAgentLaneState(state.agents);
  return (
    <div className="observatory-shell">
      <header className="observatory-topbar">
        <span className="wordmark"><span className="wordmark-mark" aria-hidden="true"><i /><i /><i /><i /></span><span>Code Nest</span></span>
        <div className="connection-state is-live"><span className="connection-indicator" aria-hidden="true" /><span>Synthetic UI preview</span></div>
      </header>
      <main className="observatory-layout">
        <AgentObservatory runId="synthetic-preview" state={state} laneState={laneState} artifactClient={new PreviewArtifactClient()} />
      </main>
    </div>
  );
}
