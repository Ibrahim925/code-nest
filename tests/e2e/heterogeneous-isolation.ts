import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import images from "../../docker/images.json";
import {
  ContainedRuntime,
  DockerContainedRuntimeEngine,
  DockerSplitContainerEngine,
  NodeDockerCommandRunner,
  SplitRuntimeContainer,
  type ContainedRuntimeManifest,
  type SplitContainerLimits,
  type SplitContainerManifest,
} from "../../apps/controller/src/containers/index.js";

const MEBIBYTE = 1_048_576;
const projectRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const runner = new NodeDockerCommandRunner();
const splitEngine = new DockerSplitContainerEngine(runner);
const containedEngine = new DockerContainedRuntimeEngine(runner);
const limits: SplitContainerLimits = {
  cpuCount: 0.25,
  memoryBytes: 64 * MEBIBYTE,
  processCount: 32,
  workspaceBytes: 8 * MEBIBYTE,
  homeBytes: 2 * MEBIBYTE,
  temporaryBytes: 2 * MEBIBYTE,
  maximumFileBytes: 4 * MEBIBYTE,
  commandTimeoutMilliseconds: 5_000,
  maximumOutputBytes: 128 * 1_024,
  stopGraceSeconds: 1,
};

export type HeterogeneousManifest =
  | SplitContainerManifest
  | ContainedRuntimeManifest;

type RuntimeBoundary = SplitRuntimeContainer | ContainedRuntime;

export class IsolatedParticipantSession {
  constructor(
    readonly manifest: HeterogeneousManifest,
    private readonly runtime: RuntimeBoundary,
  ) {}

  async captureWrite(path: string, contents: string): Promise<string> {
    if (!/^[a-z0-9][a-z0-9._/-]{0,255}$/u.test(path) || path.split("/").includes("..")) {
      throw new Error("Fixture work path is unsafe.");
    }
    const encoded = Buffer.from(contents, "utf8").toString("base64");
    const target = `/workspace/${path}`;
    const result = await this.runtime.execute({
      executable: "/bin/sh",
      arguments: [
        "-c",
        "mkdir -p \"$(dirname \"$1\")\" && printf %s \"$2\" | base64 -d > \"$1\" && base64 \"$1\"",
        "code-nest-write",
        target,
        encoded,
      ],
    });
    if (result.exitCode !== 0) {
      throw new Error(`Isolated fixture work failed: ${Buffer.from(result.stderr).toString("utf8")}`);
    }
    return Buffer.from(
      Buffer.from(result.stdout).toString("utf8").replaceAll(/\s/gu, ""),
      "base64",
    ).toString("utf8");
  }

  async reviewSeed(): Promise<void> {
    const result = await this.runtime.execute({
      executable: "/bin/sh",
      arguments: ["-c", "test -d /workspace/src && test ! -e /var/run/docker.sock"],
    });
    if (result.exitCode !== 0) throw new Error("Isolated fixture review failed.");
  }

  async stop(): Promise<void> {
    await this.runtime.stop("round_completed");
  }
}

export class HeterogeneousIsolationFactory {
  constructor(private readonly workspaceRoot: string) {}

  async start(input: {
    readonly runId: string;
    readonly round: number;
    readonly participantId: string;
    readonly workspacePath: string;
    readonly mode: "contained" | "split";
  }): Promise<IsolatedParticipantSession> {
    const common = {
      runId: input.runId,
      participantId: input.participantId,
      attemptId: `round-${input.round}`,
      workspacePath: input.workspacePath,
      user: { uid: 65_532, gid: 65_532 },
      limits,
    } as const;
    if (input.mode === "split") {
      const runtime = new SplitRuntimeContainer(this.workspaceRoot, splitEngine);
      const manifest = await runtime.start({ ...common, image: images.splitWorker });
      return new IsolatedParticipantSession(manifest, runtime);
    }

    const runtime = new ContainedRuntime(containedEngine, {
      allowedWorkspaceRoot: this.workspaceRoot,
      brokerSourcePath: join(projectRoot, "apps/controller/src/credentials"),
      trustedCodeRoot: projectRoot,
    }, {
      secrets: {
        grantId: () => `grant-r${input.round}-${input.participantId}`,
        token: () => `heterogeneous_gateway_token_${input.round}_00000000`,
      },
      clock: { now: () => new Date("2026-09-18T12:00:00.000Z") },
    });
    const manifest = await runtime.start({
      ...common,
      agentImage: images.splitWorker,
      brokerImage: images.credentialBroker,
      provider: {
        providerId: "fixture-provider",
        baseUrl: "https://provider.invalid/v1/",
        allowedPathPrefixes: ["/v1"],
        credentialHeader: "authorization",
        credentialValue: "Bearer sealed-heterogeneous-fixture",
      },
      grantLifetimeMilliseconds: 60_000,
    });
    return new IsolatedParticipantSession(manifest, runtime);
  }
}
