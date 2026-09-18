export type AgentActivity =
  | "starting"
  | "working"
  | "awaiting Town Hall"
  | "paused"
  | "quarantined"
  | "finished";

export interface AgentLaneSeed {
  readonly participantId: string;
  readonly adapterId: string;
  readonly executionMode: "contained" | "split";
  readonly modelDisclosure: string;
}

export interface AgentRuntimeProfile {
  readonly adapterName: string;
  readonly runtimeName: string;
  readonly modelName: string;
  readonly executionMode: "contained" | "split";
  readonly observabilityTier: 0 | 1 | 2;
  readonly capabilities: readonly string[];
}

export type ContainerHealth =
  | { readonly availability: "unavailable"; readonly label: "Not reported" }
  | {
      readonly availability: "available";
      readonly status: "preparing" | "healthy" | "degraded" | "stopped" | "failed";
      readonly label: string;
    };

export interface AgentLane {
  readonly participantId: string;
  readonly slot: number;
  readonly adapterId: string;
  readonly executionMode: "contained" | "split";
  readonly modelDisclosure: string;
  readonly assignmentId: string | null;
  readonly phase: { readonly round: number | null; readonly name: string | null };
  readonly activity: AgentActivity;
  readonly activityEventId: string | null;
  readonly activityBeforePause: AgentActivity | null;
  readonly runtime: AgentRuntimeProfile | null;
  readonly containerHealth: ContainerHealth;
  readonly latestCommit: string | null;
}

export interface AgentLaneState {
  readonly lanes: readonly AgentLane[];
  readonly lastDeliverySequence: number;
}
