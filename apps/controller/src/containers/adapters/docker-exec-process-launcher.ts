import {
  RuntimeAdapterError,
  type ProcessLaunchRequest,
  type ProcessLauncher,
  type ProcessSession,
} from "@code-nest/adapters";

const DOCKER_ENVIRONMENT = [
  "DOCKER_CERT_PATH",
  "DOCKER_CONFIG",
  "DOCKER_CONTEXT",
  "DOCKER_HOST",
  "DOCKER_TLS_VERIFY",
  "HOME",
  "PATH",
] as const;

function hostDockerEnvironment(): Readonly<Record<string, string>> {
  return Object.fromEntries(
    DOCKER_ENVIRONMENT.flatMap((name) => {
      const value = process.env[name];
      return value === undefined ? [] : [[name, value]];
    }),
  );
}

function invalid(message: string): never {
  throw new RuntimeAdapterError("SUBPROCESS_START_FAILED", message);
}

export class DockerExecProcessLauncher implements ProcessLauncher {
  constructor(
    private readonly containerId: string,
    private readonly hostWorkspacePath: string,
    private readonly delegate: ProcessLauncher,
  ) {
    if (!/^[a-f0-9]{64}$/u.test(containerId) || hostWorkspacePath.length === 0) {
      invalid("Contained OMP process launcher configuration is invalid.");
    }
  }

  launch(request: ProcessLaunchRequest): Promise<ProcessSession> {
    if (request.cwd !== this.hostWorkspacePath) {
      return Promise.reject(new RuntimeAdapterError(
        "SUBPROCESS_START_FAILED",
        "Contained OMP requested a workspace outside its assigned boundary.",
      ));
    }
    if (Object.keys(request.environment).length > 0) {
      return Promise.reject(new RuntimeAdapterError(
        "SUBPROCESS_START_FAILED",
        "Contained OMP environment must be installed at container creation.",
      ));
    }
    return this.delegate.launch({
      ...request,
      command: "docker",
      args: [
        "container",
        "exec",
        "--interactive",
        "--workdir",
        "/workspace",
        this.containerId,
        request.command,
        ...request.args,
      ],
      cwd: process.cwd(),
      environment: hostDockerEnvironment(),
    });
  }
}
