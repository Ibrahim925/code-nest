import { execFile } from "node:child_process";

export type DockerCommandErrorKind =
  | "executable_missing"
  | "exit"
  | "output_limit"
  | "timeout";

export class DockerCommandError extends Error {
  constructor(
    readonly kind: DockerCommandErrorKind,
    readonly exitCode: number | null,
    readonly stdout: Uint8Array,
    readonly stderr: Uint8Array,
    cause?: unknown,
  ) {
    super("Docker command failed.", cause === undefined ? undefined : { cause });
    this.name = "DockerCommandError";
  }
}

export interface DockerCommandResult {
  readonly exitCode: number;
  readonly stdout: Uint8Array;
  readonly stderr: Uint8Array;
}

export interface DockerCommandOptions {
  readonly timeoutMilliseconds?: number;
  readonly maximumOutputBytes?: number;
  readonly allowedExitCodes?: readonly number[];
}

export interface DockerCommandRunner {
  run(
    arguments_: readonly string[],
    options?: DockerCommandOptions,
  ): Promise<DockerCommandResult>;
}

const DOCKER_ENVIRONMENT = [
  "DOCKER_CERT_PATH",
  "DOCKER_CONFIG",
  "DOCKER_CONTEXT",
  "DOCKER_HOST",
  "DOCKER_TLS_VERIFY",
  "HOME",
  "PATH",
] as const;

function dockerEnvironment(): NodeJS.ProcessEnv {
  return Object.fromEntries(
    DOCKER_ENVIRONMENT.flatMap((name) => {
      const value = process.env[name];
      return value === undefined ? [] : [[name, value]];
    }),
  );
}

function bytes(value: string | Buffer): Buffer {
  return Buffer.isBuffer(value) ? value : Buffer.from(value);
}

function errorCode(error: unknown): string | number | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? error.code as string | number | undefined
    : undefined;
}

function errorKilled(error: unknown): boolean {
  return typeof error === "object" && error !== null && "killed" in error && error.killed === true;
}

export class NodeDockerCommandRunner implements DockerCommandRunner {
  run(
    arguments_: readonly string[],
    options: DockerCommandOptions = {},
  ): Promise<DockerCommandResult> {
    const maximumOutputBytes = options.maximumOutputBytes ?? 1024 * 1024;
    const allowedExitCodes = options.allowedExitCodes ?? [0];
    return new Promise((resolve, reject) => {
      execFile(
        "docker",
        [...arguments_],
        {
          encoding: null,
          env: dockerEnvironment(),
          killSignal: "SIGKILL",
          maxBuffer: maximumOutputBytes,
          timeout: options.timeoutMilliseconds ?? 30_000,
          windowsHide: true,
        },
        (error, stdout, stderr) => {
          const stdoutBytes = bytes(stdout);
          const stderrBytes = bytes(stderr);
          const code = errorCode(error);
          const exitCode = error === null ? 0 : typeof code === "number" ? code : null;
          if (
            exitCode !== null && allowedExitCodes.includes(exitCode) &&
            stdoutBytes.byteLength + stderrBytes.byteLength <= maximumOutputBytes
          ) {
            resolve({ exitCode, stdout: stdoutBytes, stderr: stderrBytes });
            return;
          }
          const kind: DockerCommandErrorKind = code === "ENOENT"
            ? "executable_missing"
            : code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" ||
                stdoutBytes.byteLength + stderrBytes.byteLength > maximumOutputBytes
              ? "output_limit"
              : errorKilled(error)
                ? "timeout"
                : "exit";
          reject(new DockerCommandError(kind, exitCode, stdoutBytes, stderrBytes, error));
        },
      );
    });
  }
}

export function dockerText(bytes_: Uint8Array): string {
  return Buffer.from(bytes_).toString("utf8");
}
