import {
  SplitContainerError,
  type NormalizedSplitContainerCommand,
  type NormalizedSplitContainerRequest,
  type ObservedContainerPolicy,
} from "../domain/split-container-policy.js";
import type {
  ContainerCommandResult,
  SplitContainerEngine,
} from "../application/split-container-engine.js";
import {
  DockerCommandError,
  dockerText,
  type DockerCommandRunner,
} from "./docker-command.js";
import { dockerParticipantCreateArguments } from "./docker-participant-profile.js";

const LIFECYCLE_OUTPUT_BYTES = 1024 * 1024;

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.map(record).filter((item): item is Record<string, unknown> => item !== null)
    : [];
}

function strings(value: unknown): string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? [...value]
    : [];
}

function number_(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : Number.NaN;
}

function lifecycleError(error: unknown): SplitContainerError {
  return new SplitContainerError(
    "CONTAINER_ENGINE_FAILURE",
    "Docker could not complete a container lifecycle operation.",
    error,
  );
}

function parseMounts(value: unknown): ObservedContainerPolicy["bindMounts"] {
  return records(value).flatMap((mount) => {
    if (
      mount.Type !== "bind" || typeof mount.Source !== "string" ||
      typeof mount.Destination !== "string" || typeof mount.RW !== "boolean"
    ) return [];
    return [{
      source: mount.Source,
      destination: mount.Destination,
      readOnly: !mount.RW,
    }];
  });
}

function parseEnvironment(value: unknown): string[] {
  return strings(value).flatMap((entry) => {
    const separator = entry.indexOf("=");
    return separator <= 0 ? [] : [entry.slice(0, separator)];
  });
}

function parseResourceLimits(
  value: unknown,
): ObservedContainerPolicy["resourceLimits"] {
  return Object.fromEntries(records(value).flatMap((limit) => {
    if (
      typeof limit.Name !== "string" || typeof limit.Soft !== "number" ||
      typeof limit.Hard !== "number"
    ) return [];
    return [[limit.Name, { soft: limit.Soft, hard: limit.Hard }]];
  }));
}

function stringRecord(value: unknown): Record<string, string> {
  const input = record(value);
  return input === null
    ? {}
    : Object.fromEntries(
      Object.entries(input).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
    );
}

function parseInspection(bytes: Uint8Array): ObservedContainerPolicy {
  let parsed: unknown;
  try { parsed = JSON.parse(dockerText(bytes)) as unknown; } catch (error: unknown) {
    throw lifecycleError(error);
  }
  const container = records(parsed)[0];
  const config = record(container?.Config);
  const state = record(container?.State);
  const host = record(container?.HostConfig);
  const temporary = record(host?.Tmpfs);
  const restart = record(host?.RestartPolicy);
  const networkSettings = record(container?.NetworkSettings);
  const networks = record(networkSettings?.Networks);
  if (
    container === undefined || config === null || state === null || host === null ||
    temporary === null || restart === null || networks === null
  ) {
    throw lifecycleError(new Error("Docker inspection response was incomplete."));
  }
  const environment = parseEnvironment(config.Env);
  return {
    containerId: typeof container.Id === "string" ? container.Id : "",
    running: state.Running === true,
    paused: state.Paused === true,
    user: typeof config.User === "string" ? config.User : "",
    privileged: host.Privileged === true,
    rootFilesystemReadOnly: host.ReadonlyRootfs === true,
    networkMode: typeof host.NetworkMode === "string" ? host.NetworkMode : "",
    ipcMode: typeof host.IpcMode === "string" ? host.IpcMode : "",
    cgroupNamespaceMode: typeof host.CgroupnsMode === "string" ? host.CgroupnsMode : "",
    pidMode: typeof host.PidMode === "string" ? host.PidMode : "",
    userNamespaceMode: typeof host.UsernsMode === "string" ? host.UsernsMode : "",
    capabilityDrops: strings(host.CapDrop),
    securityOptions: strings(host.SecurityOpt),
    deviceCount: Array.isArray(host.Devices) ? host.Devices.length : Number.NaN,
    restartPolicy: typeof restart.Name === "string" ? restart.Name : "",
    publishedPortCount: record(host.PortBindings) === null
      ? Number.NaN
      : Object.keys(record(host.PortBindings) as Record<string, unknown>).length,
    resourceLimits: parseResourceLimits(host.Ulimits),
    labels: stringRecord(config.Labels),
    memoryBytes: number_(host.Memory),
    memorySwapBytes: number_(host.MemorySwap),
    nanoCpus: number_(host.NanoCpus),
    processCount: number_(host.PidsLimit),
    bindMounts: parseMounts(container.Mounts),
    attachedNetworks: Object.keys(networks).sort(),
    temporaryFilesystems: Object.fromEntries(
      Object.entries(temporary).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
    ),
    environmentNames: environment,
  };
}

export class DockerSplitContainerEngine implements SplitContainerEngine {
  constructor(private readonly runner: DockerCommandRunner) {}

  async create(request: NormalizedSplitContainerRequest): Promise<string> {
    try {
      const result = await this.runner.run(dockerParticipantCreateArguments(request, {
        executionMode: "split",
        networkName: "none",
      }), {
        maximumOutputBytes: LIFECYCLE_OUTPUT_BYTES,
      });
      const id = dockerText(result.stdout).trim();
      if (!/^[a-f0-9]{64}$/.test(id)) throw new Error("Docker returned an invalid container ID.");
      return id;
    } catch (error: unknown) {
      throw lifecycleError(error);
    }
  }

  async start(containerId: string): Promise<void> {
    await this.#lifecycle(["container", "start", containerId]);
  }

  async inspect(containerId: string): Promise<ObservedContainerPolicy> {
    const result = await this.#lifecycle(["container", "inspect", containerId]);
    return parseInspection(result.stdout);
  }

  async execute(
    containerId: string,
    command: NormalizedSplitContainerCommand,
    limits: { readonly timeoutMilliseconds: number; readonly maximumOutputBytes: number },
  ): Promise<ContainerCommandResult> {
    try {
      return await this.runner.run([
        "container", "exec",
        "--workdir", "/workspace",
        containerId,
        command.executable,
        ...command.arguments,
      ], {
        allowedExitCodes: Array.from({ length: 256 }, (_, index) => index),
        maximumOutputBytes: limits.maximumOutputBytes,
        timeoutMilliseconds: limits.timeoutMilliseconds,
      });
    } catch (error: unknown) {
      if (error instanceof DockerCommandError && (error.kind === "timeout" || error.kind === "output_limit")) {
        throw new SplitContainerError(
          "CONTAINER_COMMAND_LIMIT",
          "Container command exceeded its time or output limit.",
          error,
        );
      }
      throw lifecycleError(error);
    }
  }

  async pause(containerId: string): Promise<void> {
    await this.#lifecycle(["container", "pause", containerId]);
  }

  async unpause(containerId: string): Promise<void> {
    await this.#lifecycle(["container", "unpause", containerId]);
  }

  async stop(containerId: string, graceSeconds: number): Promise<void> {
    await this.#lifecycle(["container", "stop", "--time", String(graceSeconds), containerId], 60_000);
  }

  async remove(containerId: string): Promise<void> {
    await this.#lifecycle(["container", "rm", "--force", "--volumes", containerId]);
  }

  async #lifecycle(arguments_: readonly string[], timeoutMilliseconds = 30_000): Promise<ContainerCommandResult> {
    try {
      return await this.runner.run(arguments_, {
        maximumOutputBytes: LIFECYCLE_OUTPUT_BYTES,
        timeoutMilliseconds,
      });
    } catch (error: unknown) {
      throw lifecycleError(error);
    }
  }
}
