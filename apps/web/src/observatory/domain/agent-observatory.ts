export interface ObservatoryAgentSeed {
  readonly participantId: string;
  readonly adapterId: string;
  readonly executionMode: "contained" | "split";
  readonly modelDisclosure: string;
}

export type ObservatoryActivityState =
  | "starting"
  | "briefing"
  | "working"
  | "waiting"
  | "testing"
  | "committing"
  | "paused"
  | "town_hall"
  | "stopped"
  | "failed";

export interface ObservatoryActivity {
  readonly availability: "awaiting" | "reported";
  readonly state: ObservatoryActivityState | null;
  readonly summary: string;
  readonly provenance: "agent_submitted" | "runtime_observed" | null;
  readonly eventId: string | null;
  readonly deliverySequence: number | null;
}

export interface ObservatoryFrame {
  readonly frameId: string;
  readonly digest: `sha256:${string}`;
  readonly width: number;
  readonly height: number;
  readonly byteCount: number;
  readonly captureReason:
    | "action"
    | "heartbeat"
    | "phase_boundary"
    | "operator_request";
  readonly frameSequence: number;
  readonly eventId: string;
}

export interface ObservatoryComputer {
  readonly status:
    | "awaiting"
    | "visible"
    | "redacted"
    | "withheld"
    | "disconnected";
  readonly freshness: "current" | "stale";
  readonly label: string;
  readonly frame: ObservatoryFrame | null;
  readonly lastVisibleFrame: ObservatoryFrame | null;
  readonly withheldReason:
    | "suspected_secret"
    | "capture_failed"
    | "policy"
    | null;
  readonly eventId: string | null;
}

export interface ObservatoryNarrative {
  readonly body: string;
  readonly provenance: "agent_submitted" | "provider_reasoning_summary";
  readonly attribution: string;
  readonly eventId: string;
}

export interface ObservatoryMemoryRevision {
  readonly memoryId: string;
  readonly revision: number;
  readonly reason: "agent_consolidation" | "round_transition" | "resume";
  readonly summary: string;
  readonly digest: `sha256:${string}`;
  readonly previousDigest: `sha256:${string}` | null;
  readonly eventId: string;
}

export interface ObservatoryTool {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly status: "started" | "completed" | "failed";
  readonly summary: string | null;
  readonly eventId: string;
}

export interface ObservatoryAgent {
  readonly slot: number;
  readonly participantId: string;
  readonly adapterId: string;
  readonly executionMode: "contained" | "split";
  readonly modelDisclosure: string;
  readonly activity: ObservatoryActivity;
  readonly computer: ObservatoryComputer;
  readonly rationale: ObservatoryNarrative | null;
  readonly memory: ObservatoryMemoryRevision | null;
  readonly latestTool: ObservatoryTool | null;
}

export interface ObservatoryPhase {
  readonly round: number | null;
  readonly name: string | null;
  readonly eventId: string | null;
  readonly transitionCount: number;
}

export interface ObservatoryDiscourseItem {
  readonly id: string;
  readonly eventId: string;
  readonly participantId: string;
  readonly channel: "general" | "town_hall";
  readonly body: string | null;
  readonly yielded: boolean;
  readonly deliverySequence: number;
}

export interface ObservatoryTimelineItem {
  readonly eventId: string;
  readonly deliverySequence: number;
  readonly participantId: string | null;
  readonly kind: string;
  readonly label: string;
}

export interface AgentObservatoryState {
  readonly agents: readonly ObservatoryAgent[];
  readonly phase: ObservatoryPhase;
  readonly discourse: readonly ObservatoryDiscourseItem[];
  readonly timeline: readonly ObservatoryTimelineItem[];
  readonly lastDeliverySequence: number;
}
