import {
  type FinalRuntimeReport,
  type RuntimeAdapter,
  type TurnResult,
} from "@code-nest/adapters";

import type { PrivateRoleBrief } from "../../briefing/domain/brief.js";
import type {
  MatchParticipantRuntime,
  MatchRuntimeStop,
  MatchRuntimeTurn,
} from "../../matches/application/ports/one-round-match-ports.js";
import type { ParticipantWorkspace } from "../../workspaces/domain/workspace.js";
import type { NormalizedOmpLiveConfiguration } from "../domain/omp-live-configuration.js";
import type {
  ContainedOmpBoundary,
  ContainedOmpDependencies,
  ContainedWorkspaceSynchronizer,
} from "./ports/contained-omp-ports.js";

const MODELS_CONFIGURATION = `providers:
  code-nest-openai:
    baseUrl: http://code-nest-broker:4317/v1/providers/openai/v1
    api: openai-responses
    apiKey: CODE_NEST_GATEWAY_TOKEN
    authHeader: true
    models:
      - id: gpt-5.6-luna
        name: OpenAI Luna
        contextWindow: 272000
        maxTokens: 32000
`;

function containerUser(): { readonly uid: number; readonly gid: number } {
  const uid = process.getuid?.() ?? 65_532;
  const gid = process.getgid?.() ?? 65_532;
  return { uid: uid > 0 ? uid : 65_532, gid: gid > 0 ? gid : 65_532 };
}

function publicMessages(commands: readonly unknown[]): string[] {
  return commands.flatMap((command) => {
    if (
      typeof command !== "object" || command === null || Array.isArray(command) ||
      !("type" in command) || command.type !== "message.publish" ||
      !("body" in command) || typeof command.body !== "string"
    ) return [];
    const body = command.body.trim();
    return body.length > 0 && body.length <= 4_096 ? [body] : [];
  });
}

function completedStatus(status: TurnResult["status"]): "completed" | "yielded" {
  if (status === "completed" || status === "yielded") return status;
  throw new Error("Contained OMP did not finish its assigned turn.");
}

async function installModelsConfiguration(boundary: ContainedOmpBoundary): Promise<void> {
  const encoded = Buffer.from(MODELS_CONFIGURATION, "utf8").toString("base64");
  const result = await boundary.execute({
    executable: "/bin/sh",
    arguments: [
      "-c",
      "mkdir -p /home/agent/.omp/agent && printf %s \"$1\" | base64 -d > /home/agent/.omp/agent/models.yml",
      "code-nest-models",
      encoded,
    ],
  });
  if (result.exitCode !== 0) {
    throw new Error("Contained OMP model gateway configuration failed.");
  }
}

export class ContainedOmpParticipant implements MatchParticipantRuntime {
  readonly participantId: string;
  #boundary: ContainedOmpBoundary | undefined;
  #adapter: RuntimeAdapter | undefined;
  #final: MatchRuntimeStop | undefined;

  constructor(
    private readonly workspace: ParticipantWorkspace,
    private readonly configuration: NormalizedOmpLiveConfiguration,
    private readonly dependencies: ContainedOmpDependencies,
    private readonly synchronizer: ContainedWorkspaceSynchronizer,
  ) {
    this.participantId = workspace.participantId;
  }

  async start(request: {
    readonly runId: string;
    readonly scenarioId: string;
    readonly workspacePath: string;
  }) {
    if (
      request.runId !== this.workspace.runId ||
      request.workspacePath !== this.workspace.path ||
      this.#boundary !== undefined
    ) {
      throw new Error("Contained OMP start request does not match its workspace.");
    }
    const boundary = this.dependencies.createBoundary();
    this.#boundary = boundary;
    const manifest = await boundary.start({
      runId: request.runId,
      participantId: this.participantId,
      attemptId: "live-1",
      agentImage: this.configuration.participantImage,
      brokerImage: this.configuration.brokerImage,
      workspacePath: this.workspace.path,
      user: containerUser(),
      provider: this.configuration.provider,
      limits: this.configuration.limits,
      grantLifetimeMilliseconds: 60 * 60_000,
    });
    try {
      await this.dependencies.preflight.verify(boundary);
      await installModelsConfiguration(boundary);
      const adapter = this.dependencies.createRuntimeAdapter({
        sessionId: `omp-${request.runId}-${this.participantId}`,
        runtimeVersion: this.configuration.runtimeVersion,
        modelProvider: this.configuration.modelProvider,
        modelName: this.configuration.modelName,
        modelSelector: this.configuration.modelSelector,
        command: "omp",
        responseTimeoutMilliseconds:
          Math.min(
            this.configuration.limits.commandTimeoutMilliseconds,
            60_000,
          ),
        startupTimeoutMilliseconds: 30_000,
        terminationGraceMilliseconds: 2_000,
      }, this.dependencies.createProcessLauncher(
        manifest.participantContainerId,
        this.workspace.path,
      ), {
        sink: this.dependencies.createObservabilitySink(request.runId, this.participantId),
        computerCapture: this.dependencies.createComputerCapture(boundary, this.participantId),
        heartbeatMilliseconds: 10_000,
      });
      this.#adapter = adapter;
      const sessionId = await adapter.start({
        match: { runId: request.runId, scenarioId: request.scenarioId },
        participant: { participantId: this.participantId },
        workspace: { path: this.workspace.path },
      });
      return { sessionId, descriptor: await adapter.metadata() };
    } catch (error: unknown) {
      let cleanupError: unknown;
      try { await boundary.stop("startup_failed"); } catch (failure: unknown) { cleanupError = failure; }
      if (cleanupError !== undefined) {
        throw new AggregateError(
          [error, cleanupError],
          "Contained OMP startup cleanup failed.",
          { cause: error },
        );
      }
      throw error;
    }
  }

  async deliverBrief(brief: PrivateRoleBrief): Promise<void> {
    const result = await this.#requiredAdapter().deliver({
      observationId: `brief-${brief.assignment.id}`,
      kind: "private-briefing",
      payload: brief,
    });
    if (!result.accepted) throw new Error("Contained OMP rejected its private brief.");
  }

  async run(request: {
    readonly maximumOutputTokens: number;
    readonly wallTimeMilliseconds: number;
  }): Promise<MatchRuntimeTurn> {
    const adapter = this.#requiredAdapter();
    const boundary = this.#requiredBoundary();
    const turn = await adapter.run(request);
    const synchronized = await this.synchronizer.synchronize(boundary, this.workspace);
    return {
      status: completedStatus(turn.status),
      candidateRevision: synchronized.candidateRevision,
      commitSummary: synchronized.commitSummary,
      publicMessages: publicMessages(turn.commands),
      usage: turn.usage,
    };
  }

  async stop(reason: string): Promise<MatchRuntimeStop> {
    if (this.#final !== undefined) return structuredClone(this.#final);
    const adapter = this.#requiredAdapter();
    const boundary = this.#requiredBoundary();
    let report: FinalRuntimeReport | undefined;
    const errors: unknown[] = [];
    try { report = await adapter.stop(reason); } catch (error: unknown) { errors.push(error); }
    try { await boundary.stop(reason); } catch (error: unknown) { errors.push(error); }
    if (errors.length > 0 || report === undefined) {
      throw new AggregateError(errors, "Contained OMP cleanup failed.");
    }
    this.#final = { sessionId: report.sessionId, turnsCompleted: report.turnsCompleted };
    return structuredClone(this.#final);
  }

  #requiredAdapter(): RuntimeAdapter {
    if (this.#adapter === undefined) throw new Error("Contained OMP has not started.");
    return this.#adapter;
  }

  #requiredBoundary(): ContainedOmpBoundary {
    if (this.#boundary === undefined) throw new Error("Contained OMP has not started.");
    return this.#boundary;
  }
}
