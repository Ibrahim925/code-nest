import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { GIT_COMMAND_OVERHEAD_BYTES, runGit } from "../../git/git-command.js";
import { DockerSplitContainerEngine } from "../../containers/adapters/docker-split-container-engine.js";
import type { DockerCommandRunner } from "../../containers/adapters/docker-command.js";
import type { ObservedContainerPolicy } from "../../containers/domain/split-container-policy.js";
import type {
  TrustedContainerEngine,
  TrustedContainerExecution,
  TrustedContainerHandle,
} from "../application/trusted-container-engine.js";
import {
  TrustedCiError,
  type NormalizedTrustedTestRequest,
  type TrustedContainerObservation,
} from "../domain/trusted-test.js";

const MEBIBYTE = 1_048_576;
const MAXIMUM_EVALUATOR_BYTES = 4 * MEBIBYTE;
const MAXIMUM_ARCHIVE_BYTES = 16 * MEBIBYTE;
const EVALUATOR_COMMAND = "tar -xf /opt/code-nest/input/candidate.tar -C /workspace && exec node /opt/code-nest/evaluator/run.mjs";

function digest(bytes: Uint8Array): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function tmpfs(target: string, bytes: number, uid: number, gid: number): string {
  return `${target}:rw,nosuid,nodev,size=${bytes},uid=${uid},gid=${gid},mode=0770`;
}

function createArguments(
  request: NormalizedTrustedTestRequest,
  archivePath: string,
  evaluatorPath: string,
): string[] {
  const { limits, user } = request;
  return [
    "container", "create",
    "--name", request.containerName,
    "--hostname", "code-nest-trusted-test",
    "--pull", "never",
    "--network", "none",
    "--ipc", "private",
    "--cgroupns", "private",
    "--read-only",
    "--cap-drop", "ALL",
    "--security-opt", "no-new-privileges=true",
    "--security-opt", "seccomp=builtin",
    "--user", `${user.uid}:${user.gid}`,
    "--memory", `${limits.memoryBytes}b`,
    "--memory-swap", `${limits.memoryBytes}b`,
    "--cpus", String(limits.cpuCount),
    "--pids-limit", String(limits.processCount),
    "--ulimit", `fsize=${limits.maximumFileBytes}:${limits.maximumFileBytes}`,
    "--ulimit", "nofile=1024:1024",
    "--tmpfs", tmpfs("/workspace", limits.workspaceBytes, user.uid, user.gid),
    "--tmpfs", tmpfs("/tmp", limits.temporaryBytes, user.uid, user.gid),
    "--mount", `type=bind,src=${archivePath},dst=/opt/code-nest/input/candidate.tar,readonly`,
    "--mount", `type=bind,src=${evaluatorPath},dst=/opt/code-nest/evaluator/run.mjs,readonly`,
    "--workdir", "/workspace",
    "--env", `CODE_NEST_CANDIDATE_DIGEST=${request.candidateDigest}`,
    "--init",
    "--restart", "no",
    "--log-driver", "none",
    "--no-healthcheck",
    "--stop-timeout", String(limits.stopGraceSeconds),
    "--label", "code-nest.managed=true",
    "--label", "code-nest.execution-mode=trusted-test",
    "--label", `code-nest.run-id=${request.runId}`,
    "--label", `code-nest.job-id=${request.jobId}`,
    "--entrypoint", "/bin/sh",
    request.evaluatorImage,
    "-c", "exec tail -f /dev/null",
  ];
}

function observation(value: ObservedContainerPolicy): TrustedContainerObservation {
  return {
    containerId: value.containerId,
    running: value.running,
    user: value.user,
    privileged: value.privileged,
    rootFilesystemReadOnly: value.rootFilesystemReadOnly,
    networkMode: value.networkMode,
    ipcMode: value.ipcMode,
    cgroupNamespaceMode: value.cgroupNamespaceMode,
    pidMode: value.pidMode,
    userNamespaceMode: value.userNamespaceMode,
    capabilityDrops: [...value.capabilityDrops],
    securityOptions: [...value.securityOptions],
    deviceCount: value.deviceCount,
    restartPolicy: value.restartPolicy,
    publishedPortCount: value.publishedPortCount,
    resourceLimits: structuredClone(value.resourceLimits),
    labels: { ...value.labels },
    memoryBytes: value.memoryBytes,
    memorySwapBytes: value.memorySwapBytes,
    nanoCpus: value.nanoCpus,
    processCount: value.processCount,
    bindMounts: structuredClone(value.bindMounts),
    attachedNetworks: [...value.attachedNetworks],
    temporaryFilesystems: { ...value.temporaryFilesystems },
    environmentNames: [...value.environmentNames],
  };
}

export class DockerTrustedContainerEngine implements TrustedContainerEngine {
  readonly #containers: DockerSplitContainerEngine;
  readonly #staging = new Map<string, string>();

  constructor(private readonly runner: DockerCommandRunner) {
    this.#containers = new DockerSplitContainerEngine(runner);
  }

  async create(request: NormalizedTrustedTestRequest): Promise<TrustedContainerHandle> {
    const root = await mkdtemp(join(tmpdir(), "code-nest-trusted-test-"));
    try {
      const [head, status, archive, evaluator] = await Promise.all([
        runGit(["rev-parse", "--verify", "HEAD^{commit}"], { cwd: request.candidatePath }),
        runGit(["status", "--porcelain=v1", "--untracked-files=all"], { cwd: request.candidatePath }),
        runGit(["archive", "--format=tar", request.candidateRevision], {
          cwd: request.candidatePath,
          maximumBytes: MAXIMUM_ARCHIVE_BYTES + GIT_COMMAND_OVERHEAD_BYTES,
        }),
        readFile(request.evaluatorPath),
      ]);
      if (
        head.stdout.toString("utf8").trim() !== request.candidateRevision || status.stdout.byteLength !== 0 ||
        archive.stdout.byteLength > MAXIMUM_ARCHIVE_BYTES || evaluator.byteLength > MAXIMUM_EVALUATOR_BYTES ||
        digest(archive.stdout) !== request.candidateDigest || digest(evaluator) !== request.evaluatorDigest
      ) {
        throw new TrustedCiError("TRUSTED_CI_MATERIAL_MISMATCH", "Candidate or evaluator material did not match its exact digest.");
      }
      const archivePath = join(root, "candidate.tar");
      const evaluatorPath = join(root, "evaluator.mjs");
      await Promise.all([
        writeFile(archivePath, archive.stdout, { mode: 0o600 }),
        writeFile(evaluatorPath, evaluator, { mode: 0o600 }),
      ]);
      const result = await this.runner.run(createArguments(request, archivePath, evaluatorPath));
      const containerId = Buffer.from(result.stdout).toString("utf8").trim();
      if (!/^[a-f0-9]{64}$/u.test(containerId)) throw new Error("Docker returned an invalid trusted container ID.");
      this.#staging.set(containerId, root);
      return {
        containerId,
        material: {
          candidateArchivePath: archivePath,
          candidateDigest: digest(archive.stdout),
          evaluatorPath,
          evaluatorDigest: digest(evaluator),
        },
      };
    } catch (error: unknown) {
      await rm(root, { recursive: true, force: true });
      if (error instanceof TrustedCiError) throw error;
      throw new TrustedCiError("TRUSTED_CI_EXECUTION_FAILED", "Trusted test container could not be created.", error);
    }
  }

  start(containerId: string): Promise<void> { return this.#containers.start(containerId); }

  async inspect(containerId: string): Promise<TrustedContainerObservation> {
    return observation(await this.#containers.inspect(containerId));
  }

  execute(
    containerId: string,
    request: NormalizedTrustedTestRequest,
  ): Promise<TrustedContainerExecution> {
    return this.#containers.execute(containerId, {
      executable: "/bin/sh",
      arguments: ["-c", EVALUATOR_COMMAND],
    }, {
      timeoutMilliseconds: request.limits.wallTimeMilliseconds,
      maximumOutputBytes: request.limits.maximumOutputBytes,
    });
  }

  stop(containerId: string, graceSeconds: number): Promise<void> {
    return this.#containers.stop(containerId, graceSeconds);
  }

  async remove(containerId: string): Promise<void> {
    const root = this.#staging.get(containerId);
    try { await this.#containers.remove(containerId); }
    finally {
      this.#staging.delete(containerId);
      if (root !== undefined) await rm(root, { recursive: true, force: true });
    }
  }
}
