import type { BriefingReceipt, BriefingRequest, PrivateRoleBrief } from "../../../briefing/domain/brief.js";
import type { PatchIntegrationReport, PatchIntegrationRequest } from "../../../integration/domain/integration.js";
import type { ParticipantWorkspace, WorkspaceCapture } from "../../../workspaces/domain/workspace.js";
import type { ProvisionWorkspacesRequest } from "../../../workspaces/application/workspace-manager.js";
import type {
  ReplayableIntegrationReport,
} from "../../domain/one-round-match.js";

export interface MatchRunLifecycle {
  create(runId: string, commandId: string): unknown;
}

export interface MatchWorkspaceManager {
  provision(request: ProvisionWorkspacesRequest): Promise<readonly ParticipantWorkspace[]>;
  capture(workspace: ParticipantWorkspace): Promise<WorkspaceCapture>;
}

export interface MatchRuntimeDescriptor {
  readonly adapterName: string;
  readonly adapterVersion: string;
  readonly runtimeName: string;
  readonly runtimeVersion: string;
  readonly modelProvider: string;
  readonly modelName: string;
  readonly executionMode: "contained" | "split";
  readonly observabilityTier: 0 | 1 | 2;
  readonly capabilities: readonly string[];
}

export interface MatchRuntimeTurn {
  readonly status: "completed" | "yielded";
  readonly candidateRevision: string;
  readonly commitSummary: string;
  readonly publicMessages: readonly string[];
  readonly usage: {
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly wallTimeMilliseconds: number;
  } | null;
}

export interface MatchRuntimeStop {
  readonly sessionId: string;
  readonly turnsCompleted: number;
}

export interface MatchParticipantRuntime {
  readonly participantId: string;
  start(request: {
    readonly runId: string;
    readonly scenarioId: string;
    readonly workspacePath: string;
  }): Promise<{ readonly sessionId: string; readonly descriptor: MatchRuntimeDescriptor }>;
  deliverBrief(brief: PrivateRoleBrief): Promise<void>;
  run(request: {
    readonly maximumOutputTokens: number;
    readonly wallTimeMilliseconds: number;
  }): Promise<MatchRuntimeTurn>;
  stop(reason: string): Promise<MatchRuntimeStop>;
}

export interface MatchRuntimeFactory {
  create(workspace: ParticipantWorkspace): Promise<MatchParticipantRuntime>;
}

export interface MatchBriefing {
  brief(
    request: BriefingRequest,
    runtimes: ReadonlyMap<string, MatchParticipantRuntime>,
  ): Promise<BriefingReceipt>;
}

export interface MatchIntegrator {
  integrate(request: PatchIntegrationRequest): Promise<PatchIntegrationReport>;
}

export interface IntegrationReportPublisher {
  publish(report: ReplayableIntegrationReport): Promise<`sha256:${string}`>;
}

export type OneRoundEvidence =
  | { readonly type: "workspaces_ready"; readonly participantIds: readonly string[]; readonly baseRevision: string }
  | { readonly type: "runtime_started"; readonly participantId: string; readonly sessionId: string; readonly descriptor: MatchRuntimeDescriptor }
  | { readonly type: "runtime_stopped"; readonly participantId: string; readonly turnsCompleted: number }
  | { readonly type: "work_captured"; readonly participantId: string; readonly turn: MatchRuntimeTurn }
  | { readonly type: "integration_completed"; readonly report: ReplayableIntegrationReport; readonly reportDigest: `sha256:${string}` }
  | { readonly type: "match_completed"; readonly candidateRevision: string };

export interface OneRoundEvidenceRecorder {
  record(runId: string, evidence: OneRoundEvidence): Promise<void>;
}
