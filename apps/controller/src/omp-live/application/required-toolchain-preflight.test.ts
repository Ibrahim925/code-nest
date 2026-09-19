import { describe, expect, it } from "vitest";

import type { SplitContainerCommand } from "../../containers/domain/split-container-policy.js";
import type { ContainedOmpBoundary } from "./ports/contained-omp-ports.js";
import { RequiredToolchainPreflight } from "./required-toolchain-preflight.js";

function boundary(
  execute: (command: SplitContainerCommand) => Promise<{
    readonly exitCode: number;
    readonly stdout: Uint8Array;
    readonly stderr: Uint8Array;
  }>,
): ContainedOmpBoundary {
  return {
    start: async () => { throw new Error("Unexpected start."); },
    execute,
    stop: async () => { throw new Error("Unexpected stop."); },
  };
}

const requirements = [
  { executable: "node", versionArguments: ["--version"] },
  { executable: "npm", versionArguments: ["--version"] },
] as const;

describe("required participant toolchain preflight", () => {
  it("probes every scenario-required executable before work begins", async () => {
    const commands: SplitContainerCommand[] = [];
    const preflight = new RequiredToolchainPreflight(requirements);

    await preflight.verify(boundary(async (command) => {
      commands.push(command);
      return {
        exitCode: 0,
        stdout: new TextEncoder().encode("available"),
        stderr: new Uint8Array(),
      };
    }));

    expect(commands).toEqual([
      { executable: "node", arguments: ["--version"] },
      { executable: "npm", arguments: ["--version"] },
    ]);
  });

  it("fails closed with a safe error when a required tool is unavailable", async () => {
    const commands: SplitContainerCommand[] = [];
    const preflight = new RequiredToolchainPreflight(requirements);

    const verification = preflight.verify(boundary(async (command) => {
      commands.push(command);
      return {
        exitCode: command.executable === "npm" ? 127 : 0,
        stdout: new Uint8Array(),
        stderr: new TextEncoder().encode("untrusted runtime detail"),
      };
    }));

    await expect(verification).rejects.toMatchObject({
      name: "ParticipantToolchainError",
      code: "PARTICIPANT_TOOLCHAIN_UNAVAILABLE",
      message: "Contained participant is missing the required npm tool.",
    });
    expect(commands).toHaveLength(2);
    await expect(verification).rejects.not.toThrow(/untrusted runtime detail/u);
  });

  it("rejects ambiguous or unsafe requirement declarations", () => {
    expect(() => new RequiredToolchainPreflight([])).toThrow(/requirements/u);
    expect(() => new RequiredToolchainPreflight([
      { executable: "node", versionArguments: ["--version"] },
      { executable: "node", versionArguments: ["-v"] },
    ])).toThrow(/requirements/u);
    expect(() => new RequiredToolchainPreflight([
      { executable: "node;whoami", versionArguments: ["--version"] },
    ])).toThrow(/requirements/u);
  });
});
