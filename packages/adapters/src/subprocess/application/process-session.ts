export type ProcessSignal = "SIGINT" | "SIGKILL" | "SIGTERM";

export interface ProcessExit {
  readonly code: number | null;
  readonly signal: ProcessSignal | string | null;
}

export interface ProcessSession {
  send(line: string): void;
  signal(signal: ProcessSignal): boolean;
  readonly completion: Promise<ProcessExit>;
}

export interface ProcessLaunchRequest {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly environment: Readonly<Record<string, string>>;
  readonly maximumLineBytes: number;
  readonly onStdoutLine: (line: string) => void;
  readonly onStderrLine: (line: string) => void;
  readonly onProtocolError: (error: Error) => void;
}

export interface ProcessLauncher {
  launch(request: ProcessLaunchRequest): Promise<ProcessSession>;
}
