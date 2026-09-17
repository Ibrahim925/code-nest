import { execFile } from "node:child_process";

export const DEFAULT_MAX_CAPTURE_BYTES = 16 * 1024 * 1024;
export const GIT_COMMAND_OVERHEAD_BYTES = 1024 * 1024;

export interface GitCommandResult {
  readonly stdout: Buffer;
  readonly stderr: Buffer;
  readonly exitCode: number;
}

export class GitCommandError extends Error {
  constructor(
    readonly exitCode: number | null,
    readonly stderr: Buffer,
    cause?: unknown,
  ) {
    super("Git command failed.", cause === undefined ? undefined : { cause });
    this.name = "GitCommandError";
  }
}

export function isNodeErrorWithCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error
    ? error.code === code
    : false;
}

export function runGit(
  arguments_: readonly string[],
  options: {
    readonly cwd?: string;
    readonly maximumBytes?: number;
    readonly allowedExitCodes?: readonly number[];
  } = {},
): Promise<GitCommandResult> {
  const maximumBytes =
    options.maximumBytes ?? DEFAULT_MAX_CAPTURE_BYTES + GIT_COMMAND_OVERHEAD_BYTES;
  const allowedExitCodes = options.allowedExitCodes ?? [0];

  return new Promise((resolvePromise, rejectPromise) => {
    execFile(
      "git",
      [...arguments_],
      {
        cwd: options.cwd,
        encoding: null,
        env: {
          ...process.env,
          GIT_CONFIG_GLOBAL: "/dev/null",
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_CONFIG_SYSTEM: "/dev/null",
          GIT_TERMINAL_PROMPT: "0",
        },
        maxBuffer: maximumBytes,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        const stdoutBuffer = Buffer.isBuffer(stdout)
          ? stdout
          : Buffer.from(stdout);
        const stderrBuffer = Buffer.isBuffer(stderr)
          ? stderr
          : Buffer.from(stderr);
        const exitCode =
          error === null
            ? 0
            : typeof error.code === "number"
              ? error.code
              : null;

        if (exitCode !== null && allowedExitCodes.includes(exitCode)) {
          resolvePromise({ exitCode, stderr: stderrBuffer, stdout: stdoutBuffer });
          return;
        }
        rejectPromise(new GitCommandError(exitCode, stderrBuffer, error));
      },
    );
  });
}

export function gitText(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("utf8");
}

export function gitLineList(bytes: Uint8Array): string[] {
  const value = gitText(bytes).trim();
  return value.length === 0 ? [] : value.split("\n");
}
