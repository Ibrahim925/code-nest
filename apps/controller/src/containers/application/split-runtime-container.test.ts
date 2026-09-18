import { describe, expect, it } from "vitest";

import type {
  ContainerCommandResult,
  SplitContainerEngine,
} from "./split-container-engine.js";
import { SplitRuntimeContainer } from "./split-runtime-container.js";
import type { ObservedContainerPolicy } from "../domain/split-container-policy.js";

const CONTAINER_ID = "a".repeat(64);
const WORKSPACE = "/tmp/code-nest-workspaces/run-a/participant-a";

function request() {
  return {
    runId: "run-a",
    participantId: "participant-a",
    attemptId: "attempt-a",
    image: `worker@sha256:${"b".repeat(64)}`,
    workspacePath: WORKSPACE,
    user: { uid: 65_532, gid: 65_532 },
    limits: {
      cpuCount: 1,
      memoryBytes: 64 * 1_048_576,
      processCount: 32,
      workspaceBytes: 8 * 1_048_576,
      homeBytes: 2 * 1_048_576,
      temporaryBytes: 2 * 1_048_576,
      maximumFileBytes: 4 * 1_048_576,
      commandTimeoutMilliseconds: 1_000,
      maximumOutputBytes: 4_096,
      stopGraceSeconds: 1,
    },
  } as const;
}

function observed(input: ReturnType<typeof request>): ObservedContainerPolicy {
  const { limits, user } = input;
  return {
    containerId: CONTAINER_ID,
    running: true,
    paused: false,
    user: `${user.uid}:${user.gid}`,
    privileged: false,
    rootFilesystemReadOnly: true,
    networkMode: "none",
    ipcMode: "private",
    cgroupNamespaceMode: "private",
    pidMode: "",
    userNamespaceMode: "",
    capabilityDrops: ["ALL"],
    securityOptions: ["no-new-privileges=true"],
    deviceCount: 0,
    restartPolicy: "no",
    resourceLimits: {
      fsize: { soft: limits.maximumFileBytes, hard: limits.maximumFileBytes },
      nofile: { soft: 1_024, hard: 1_024 },
    },
    labels: {
      "code-nest.managed": "true",
      "code-nest.execution-mode": "split",
      "code-nest.run-id": input.runId,
      "code-nest.participant-id": input.participantId,
      "code-nest.attempt-id": input.attemptId,
    },
    memoryBytes: limits.memoryBytes,
    memorySwapBytes: limits.memoryBytes,
    nanoCpus: 1_000_000_000,
    processCount: limits.processCount,
    bindMounts: [{ source: WORKSPACE, destination: "/opt/code-nest/seed", readOnly: true }],
    temporaryFilesystems: {
      "/workspace": `rw,size=${limits.workspaceBytes}`,
      "/home/agent": `rw,size=${limits.homeBytes}`,
      "/tmp": `rw,size=${limits.temporaryBytes}`,
    },
    environmentNames: ["HOME", "PATH"],
  };
}

class PolicyDroppingEngine implements SplitContainerEngine {
  readonly removed: string[] = [];
  async create(): Promise<string> { return CONTAINER_ID; }
  async start(): Promise<void> {}
  async inspect(): Promise<ObservedContainerPolicy> { return observed(request()); }
  async execute(): Promise<ContainerCommandResult> {
    return { exitCode: 0, stdout: new Uint8Array(), stderr: new Uint8Array() };
  }
  async pause(): Promise<void> {}
  async unpause(): Promise<void> {}
  async stop(): Promise<void> {}
  async remove(containerId: string): Promise<void> { this.removed.push(containerId); }
}

describe("split-runtime application boundary", () => {
  it("rolls back a container when Docker omits a required security option", async () => {
    const engine = new PolicyDroppingEngine();
    const runtime = new SplitRuntimeContainer("/tmp/code-nest-workspaces", engine);

    await expect(runtime.start(request())).rejects.toMatchObject({
      code: "CONTAINER_POLICY_MISMATCH",
    });
    expect(engine.removed).toEqual([CONTAINER_ID]);
    await expect(runtime.execute({ executable: "true" })).rejects.toMatchObject({
      code: "CONTAINER_NOT_RUNNING",
    });
  });
});
