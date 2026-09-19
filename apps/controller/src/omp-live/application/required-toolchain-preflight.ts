import type {
  ContainedOmpBoundary,
  ContainedParticipantPreflight,
} from "./ports/contained-omp-ports.js";

const EXECUTABLE = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/u;

export interface RequiredParticipantTool {
  readonly executable: string;
  readonly versionArguments: readonly string[];
}

export class ParticipantToolchainError extends Error {
  readonly code = "PARTICIPANT_TOOLCHAIN_UNAVAILABLE";

  constructor(executable: string, cause?: unknown) {
    super(
      `Contained participant is missing the required ${executable} tool.`,
      cause === undefined ? undefined : { cause },
    );
    this.name = "ParticipantToolchainError";
  }
}

function normalizeTools(
  tools: readonly RequiredParticipantTool[],
): readonly RequiredParticipantTool[] {
  if (
    tools.length === 0 ||
    new Set(tools.map(({ executable }) => executable)).size !== tools.length ||
    tools.some(({ executable, versionArguments }) =>
      !EXECUTABLE.test(executable) ||
      versionArguments.length === 0 ||
      versionArguments.length > 8 ||
      versionArguments.some((argument) =>
        argument.length === 0 || argument.length > 128 || argument.includes("\0")
      )
    )
  ) {
    throw new TypeError("Participant toolchain requirements are invalid.");
  }
  return tools.map(({ executable, versionArguments }) => ({
    executable,
    versionArguments: [...versionArguments],
  }));
}

export class RequiredToolchainPreflight implements ContainedParticipantPreflight {
  readonly #tools: readonly RequiredParticipantTool[];

  constructor(tools: readonly RequiredParticipantTool[]) {
    this.#tools = normalizeTools(tools);
  }

  async verify(boundary: ContainedOmpBoundary): Promise<void> {
    for (const tool of this.#tools) {
      try {
        const result = await boundary.execute({
          executable: tool.executable,
          arguments: tool.versionArguments,
        });
        if (result.exitCode !== 0) throw new Error("Version probe failed.");
      } catch (error: unknown) {
        throw new ParticipantToolchainError(tool.executable, error);
      }
    }
  }
}
