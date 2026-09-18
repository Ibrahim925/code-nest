import type { NormalizedSplitContainerRequest } from "../domain/split-container-policy.js";

const STARTUP_COMMAND = "cp -R /opt/code-nest/seed/. /workspace && exec tail -f /dev/null";

function tmpfs(
  target: string,
  bytes: number,
  uid: number,
  gid: number,
  noExecute = false,
): string {
  const options = ["rw", "nosuid", "nodev"];
  if (noExecute) options.push("noexec");
  options.push(`size=${bytes}`, `uid=${uid}`, `gid=${gid}`, "mode=0770");
  return `${target}:${options.join(",")}`;
}

export function dockerParticipantCreateArguments(
  request: NormalizedSplitContainerRequest,
  options: {
    readonly executionMode: "contained" | "split";
    readonly networkName: string;
    readonly environment?: Readonly<Record<string, string>>;
    readonly environmentFile?: string;
  },
): string[] {
  const { limits, user } = request;
  const environment = {
    HOME: "/home/agent",
    TMPDIR: "/tmp",
    CODE_NEST_EXECUTION_MODE: options.executionMode,
    ...options.environment,
  };
  return [
    "container", "create",
    "--name", request.containerName,
    "--hostname", request.participantId,
    "--pull", "never",
    "--network", options.networkName,
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
    "--tmpfs", tmpfs("/home/agent", limits.homeBytes, user.uid, user.gid, true),
    "--tmpfs", tmpfs("/tmp", limits.temporaryBytes, user.uid, user.gid),
    "--mount", `type=bind,src=${request.workspacePath},dst=/opt/code-nest/seed,readonly`,
    "--workdir", "/workspace",
    ...Object.entries(environment).flatMap(([name, value]) => ["--env", `${name}=${value}`]),
    ...(options.environmentFile === undefined ? [] : ["--env-file", options.environmentFile]),
    "--init",
    "--restart", "no",
    "--log-driver", "none",
    "--no-healthcheck",
    "--stop-timeout", String(limits.stopGraceSeconds),
    "--label", "code-nest.managed=true",
    "--label", `code-nest.execution-mode=${options.executionMode}`,
    "--label", `code-nest.run-id=${request.runId}`,
    "--label", `code-nest.participant-id=${request.participantId}`,
    "--label", `code-nest.attempt-id=${request.attemptId}`,
    "--entrypoint", "/bin/sh",
    request.image,
    "-c", STARTUP_COMMAND,
  ];
}
