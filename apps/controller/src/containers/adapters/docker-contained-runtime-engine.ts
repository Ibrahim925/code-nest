import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type {
  ContainedNetworkCreateRequest,
  ContainedRuntimeEngine,
} from "../application/contained-runtime-engine.js";
import type { ContainerCommandResult } from "../application/split-container-engine.js";
import type {
  NormalizedContainedRuntimeRequest,
  ObservedContainedNetwork,
} from "../domain/contained-container-policy.js";
import {
  SplitContainerError,
  type NormalizedSplitContainerCommand,
  type ObservedContainerPolicy,
} from "../domain/split-container-policy.js";
import {
  DockerCommandError,
  dockerText,
  type DockerCommandRunner,
} from "./docker-command.js";
import { dockerParticipantCreateArguments } from "./docker-participant-profile.js";
import { DockerSplitContainerEngine } from "./docker-split-container-engine.js";

const MEBIBYTE = 1_048_576;
const OUTPUT_LIMIT = MEBIBYTE;

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function engineError(error: unknown): SplitContainerError {
  return new SplitContainerError(
    "CONTAINER_ENGINE_FAILURE",
    "Docker could not complete a contained-runtime operation.",
    error,
  );
}

async function environmentFile<T>(
  values: Readonly<Record<string, string>>,
  use: (path: string) => Promise<T>,
): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), "code-nest-container-env-"));
  const path = join(root, "environment");
  for (const [name, value] of Object.entries(values)) {
    if (!/^[A-Z][A-Z0-9_]{0,63}$/u.test(name) || /[\r\n\0]/u.test(value)) {
      await rm(root, { recursive: true, force: true });
      throw new SplitContainerError("INVALID_CONTAINER_INPUT", "Container environment file is invalid.");
    }
  }
  await writeFile(path, `${Object.entries(values).map(([name, value]) => `${name}=${value}`).join("\n")}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  try { return await use(path); }
  finally { await rm(root, { recursive: true, force: true }); }
}

function brokerArguments(request: NormalizedContainedRuntimeRequest, environmentPath: string): string[] {
  return [
    "container", "create",
    "--name", request.brokerContainerName,
    "--hostname", "code-nest-broker",
    "--pull", "never",
    "--network", request.egressNetworkName,
    "--ipc", "private",
    "--cgroupns", "private",
    "--read-only",
    "--cap-drop", "ALL",
    "--security-opt", "no-new-privileges=true",
    "--security-opt", "seccomp=builtin",
    "--user", "1000:1000",
    "--memory", `${128 * MEBIBYTE}b`,
    "--memory-swap", `${128 * MEBIBYTE}b`,
    "--cpus", "0.5",
    "--pids-limit", "64",
    "--ulimit", `${"fsize"}=${8 * MEBIBYTE}:${8 * MEBIBYTE}`,
    "--ulimit", "nofile=1024:1024",
    "--tmpfs", `/tmp:rw,nosuid,nodev,noexec,size=${16 * MEBIBYTE},uid=1000,gid=1000,mode=0700`,
    "--mount", `type=bind,src=${request.brokerSourcePath},dst=/opt/code-nest/credentials,readonly`,
    "--workdir", "/tmp",
    "--env", "NODE_NO_WARNINGS=1",
    "--env-file", environmentPath,
    "--init",
    "--restart", "no",
    "--log-driver", "local",
    "--log-opt", "max-size=1m",
    "--log-opt", "max-file=2",
    "--no-healthcheck",
    "--stop-timeout", "2",
    "--label", "code-nest.managed=true",
    "--label", "code-nest.execution-mode=broker",
    "--label", `code-nest.run-id=${request.participant.runId}`,
    "--label", `code-nest.participant-id=${request.participant.participantId}`,
    "--label", `code-nest.attempt-id=${request.participant.attemptId}`,
    "--entrypoint", "node",
    request.brokerImage,
    "--experimental-transform-types",
    "/opt/code-nest/credentials/broker-process.ts",
  ];
}

function parseNetwork(bytes: Uint8Array): ObservedContainedNetwork {
  let parsed: unknown;
  try { parsed = JSON.parse(dockerText(bytes)) as unknown; } catch (error: unknown) { throw engineError(error); }
  const network = Array.isArray(parsed) ? record(parsed[0]) : null;
  const labels = record(network?.Labels);
  const containers = record(network?.Containers);
  if (
    network === null || labels === null || containers === null || typeof network.Id !== "string" ||
    typeof network.Name !== "string" || typeof network.Internal !== "boolean"
  ) throw engineError(new Error("Docker network inspection response was incomplete."));
  return {
    networkId: network.Id,
    name: network.Name,
    internal: network.Internal,
    labels: Object.fromEntries(
      Object.entries(labels).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
    ),
    containerIds: Object.keys(containers).sort(),
  };
}

export class DockerContainedRuntimeEngine implements ContainedRuntimeEngine {
  readonly #containers: DockerSplitContainerEngine;

  constructor(private readonly runner: DockerCommandRunner) {
    this.#containers = new DockerSplitContainerEngine(runner);
  }

  async createNetwork(request: ContainedNetworkCreateRequest): Promise<string> {
    const arguments_ = [
      "network", "create", "--driver", "bridge",
      ...(request.internal ? [
        "--internal",
        "--opt", "com.docker.network.bridge.gateway_mode_ipv4=isolated",
      ] : []),
      "--label", "code-nest.managed=true",
      "--label", `code-nest.run-id=${request.runId}`,
      "--label", `code-nest.participant-id=${request.participantId}`,
      "--label", `code-nest.network-kind=${request.kind}`,
      request.name,
    ];
    return this.#create(arguments_, "network");
  }

  async createBroker(request: NormalizedContainedRuntimeRequest): Promise<string> {
    const encoded = Buffer.from(JSON.stringify(request.brokerConfiguration), "utf8").toString("base64url");
    return environmentFile({ CODE_NEST_BROKER_CONFIG_BASE64: encoded }, (path) =>
      this.#create(brokerArguments(request, path), "container")
    );
  }

  async connectNetwork(networkName: string, containerId: string, alias: string): Promise<void> {
    await this.#run(["network", "connect", "--alias", alias, networkName, containerId]);
  }

  async createParticipant(request: NormalizedContainedRuntimeRequest): Promise<string> {
    return environmentFile({
      CODE_NEST_GATEWAY_URL: request.gatewayUrl,
      CODE_NEST_GATEWAY_TOKEN: request.grant.token,
      CODE_NEST_PROVIDER_ID: request.grant.providerId,
    }, (path) => this.#create(dockerParticipantCreateArguments(request.participant, {
      executionMode: "contained",
      networkName: request.privateNetworkName,
      environmentFile: path,
    }), "container"));
  }

  async startContainer(containerId: string): Promise<void> { await this.#containers.start(containerId); }

  async awaitBrokerReady(containerId: string, timeoutMilliseconds: number): Promise<void> {
    const deadline = Date.now() + timeoutMilliseconds;
    do {
      try {
        await this.runner.run([
          "container", "exec", containerId, "node", "-e",
          'fetch("http://127.0.0.1:4317/health/live").then(r=>process.exit(r.status===204?0:1)).catch(()=>process.exit(1))',
        ], { maximumOutputBytes: 16 * 1_024, timeoutMilliseconds: 1_000 });
        return;
      } catch (error: unknown) {
        if (!(error instanceof DockerCommandError) || Date.now() >= deadline) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    } while (Date.now() < deadline);
    throw engineError(new Error("Credential broker did not become ready."));
  }

  inspectContainer(containerId: string): Promise<ObservedContainerPolicy> {
    return this.#containers.inspect(containerId);
  }

  async inspectNetwork(networkId: string): Promise<ObservedContainedNetwork> {
    const result = await this.#run(["network", "inspect", networkId]);
    return parseNetwork(result.stdout);
  }

  executeParticipant(
    containerId: string,
    command: NormalizedSplitContainerCommand,
    limits: { readonly timeoutMilliseconds: number; readonly maximumOutputBytes: number },
  ): Promise<ContainerCommandResult> {
    return this.#containers.execute(containerId, command, limits);
  }

  async brokerLogs(containerId: string, maximumBytes: number): Promise<Uint8Array> {
    const result = await this.#run(["container", "logs", containerId], 30_000, maximumBytes);
    return result.stdout;
  }

  async stopContainer(containerId: string, graceSeconds: number): Promise<void> {
    await this.#containers.stop(containerId, graceSeconds);
  }

  async removeContainer(containerId: string): Promise<void> { await this.#containers.remove(containerId); }
  async removeNetwork(networkId: string): Promise<void> { await this.#run(["network", "rm", networkId]); }

  async #create(arguments_: readonly string[], kind: "container" | "network"): Promise<string> {
    const result = await this.#run(arguments_);
    const id = dockerText(result.stdout).trim();
    if (!/^[a-f0-9]{64}$/u.test(id)) throw engineError(new Error(`Docker returned an invalid ${kind} ID.`));
    return id;
  }

  async #run(
    arguments_: readonly string[],
    timeoutMilliseconds = 30_000,
    maximumOutputBytes = OUTPUT_LIMIT,
  ): Promise<ContainerCommandResult> {
    try { return await this.runner.run(arguments_, { timeoutMilliseconds, maximumOutputBytes }); }
    catch (error: unknown) { throw engineError(error); }
  }
}
