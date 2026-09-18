import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

import type {
  ProcessExit,
  ProcessLaunchRequest,
  ProcessLauncher,
  ProcessSession,
  ProcessSignal,
} from "../application/process-session.js";

class BoundedLineReader {
  #pending = Buffer.alloc(0);

  constructor(
    private readonly maximumLineBytes: number,
    private readonly onLine: (line: string) => void,
  ) {}

  push(chunk: Buffer): void {
    this.#pending = Buffer.concat([this.#pending, chunk]);
    while (true) {
      const newline = this.#pending.indexOf(0x0a);
      if (newline < 0) break;
      const line = this.#pending.subarray(0, newline);
      this.#pending = this.#pending.subarray(newline + 1);
      this.#emit(line);
    }
    if (this.#pending.byteLength > this.maximumLineBytes) {
      throw new Error("Subprocess output line exceeded its byte limit.");
    }
  }

  end(): void {
    if (this.#pending.byteLength > 0) this.#emit(this.#pending);
    this.#pending = Buffer.alloc(0);
  }

  #emit(bytes: Buffer): void {
    const normalized = bytes.at(-1) === 0x0d ? bytes.subarray(0, -1) : bytes;
    if (normalized.byteLength > this.maximumLineBytes) {
      throw new Error("Subprocess output line exceeded its byte limit.");
    }
    this.onLine(normalized.toString("utf8"));
  }
}

class NodeProcessSession implements ProcessSession {
  readonly completion: Promise<ProcessExit>;

  constructor(private readonly child: ChildProcessWithoutNullStreams) {
    this.completion = new Promise((resolve) => {
      child.once("close", (code, signal) => resolve({ code, signal }));
    });
  }

  send(line: string): void {
    if (!this.child.stdin.writable) throw new Error("Subprocess input is closed.");
    this.child.stdin.write(line, "utf8", (error) => {
      if (error !== null) this.child.emit("error", error);
    });
  }

  signal(signal: ProcessSignal): boolean {
    return this.child.kill(signal);
  }
}

function attachOutput(
  child: ChildProcessWithoutNullStreams,
  request: ProcessLaunchRequest,
): void {
  const stdout = new BoundedLineReader(
    request.maximumLineBytes,
    request.onStdoutLine,
  );
  const stderr = new BoundedLineReader(
    request.maximumLineBytes,
    request.onStderrLine,
  );
  const push = (reader: BoundedLineReader, chunk: Buffer) => {
    try {
      reader.push(chunk);
    } catch (error: unknown) {
      request.onProtocolError(error instanceof Error ? error : new Error("Output failed."));
    }
  };
  child.stdout.on("data", (chunk: Buffer) => push(stdout, chunk));
  child.stderr.on("data", (chunk: Buffer) => push(stderr, chunk));
  child.stdout.on("end", () => {
    try { stdout.end(); } catch (error: unknown) {
      request.onProtocolError(error instanceof Error ? error : new Error("Output failed."));
    }
  });
  child.stderr.on("end", () => {
    try { stderr.end(); } catch (error: unknown) {
      request.onProtocolError(error instanceof Error ? error : new Error("Output failed."));
    }
  });
}

export class NodeProcessLauncher implements ProcessLauncher {
  launch(request: ProcessLaunchRequest): Promise<ProcessSession> {
    return new Promise((resolve, reject) => {
      let spawned = false;
      const child = spawn(request.command, [...request.args], {
        cwd: request.cwd,
        env: { ...request.environment },
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
      attachOutput(child, request);
      child.once("error", (error) => {
        if (spawned) request.onProtocolError(error);
        else reject(error);
      });
      child.once("spawn", () => {
        spawned = true;
        resolve(new NodeProcessSession(child));
      });
    });
  }
}
