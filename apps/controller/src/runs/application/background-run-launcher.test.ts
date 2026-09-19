import { describe, expect, it, vi } from "vitest";

import type { RunSetupConfiguration } from "@code-nest/protocol";

import { BackgroundRunLauncher } from "./background-run-launcher.js";

const configuration = {
  schemaVersion: "1.0",
  runId: "run-1",
} as RunSetupConfiguration;

describe("BackgroundRunLauncher", () => {
  it("starts a configured run only once across exact retries", async () => {
    const execute = vi.fn(async () => undefined);
    const report = vi.fn();
    const launcher = new BackgroundRunLauncher({ execute }, { report });

    await Promise.all([
      launcher.launch(configuration),
      launcher.launch(structuredClone(configuration)),
    ]);

    expect(execute).toHaveBeenCalledTimes(1);
    expect(report).not.toHaveBeenCalled();
  });

  it("contains asynchronous failures at the background boundary", async () => {
    const failure = new Error("private provider failure");
    const report = vi.fn();
    const launcher = new BackgroundRunLauncher(
      { execute: async () => Promise.reject(failure) },
      { report },
    );

    await expect(launcher.launch(configuration)).resolves.toBeUndefined();
    expect(report).toHaveBeenCalledWith("run-1", failure);
  });
});
