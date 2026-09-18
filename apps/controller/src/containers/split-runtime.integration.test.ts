import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import images from "../../../../docker/images.json";

import {
  DockerSplitContainerEngine,
  NodeDockerCommandRunner,
  normalizeSplitContainerRequest,
  SplitRuntimeContainer,
  type SplitContainerLimits,
} from "./index.js";

const MEBIBYTE = 1_048_576;
const TEST_IMAGE = images.splitWorker;
const roots: string[] = [];
const containers = new Set<string>();
const runner = new NodeDockerCommandRunner();
const engine = new DockerSplitContainerEngine(runner);

const limits: SplitContainerLimits = {
  cpuCount: 0.25,
  memoryBytes: 64 * MEBIBYTE,
  processCount: 32,
  workspaceBytes: 8 * MEBIBYTE,
  homeBytes: 2 * MEBIBYTE,
  temporaryBytes: 2 * MEBIBYTE,
  maximumFileBytes: 4 * MEBIBYTE,
  commandTimeoutMilliseconds: 5_000,
  maximumOutputBytes: 64 * 1_024,
  stopGraceSeconds: 1,
};

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "code-nest-containers-"));
  const workspace = join(root, "run-a", "participant-a");
  const otherWorkspace = join(root, "run-a", "participant-b");
  await mkdir(workspace, { recursive: true });
  await mkdir(otherWorkspace, { recursive: true });
  await writeFile(join(workspace, "brief.txt"), "authorized participant seed\n", "utf8");
  await writeFile(join(otherWorkspace, "private.txt"), "other participant secret\n", "utf8");
  roots.push(root);
  return { root, workspace, otherWorkspace };
}

function request(
  workspacePath: string,
  overrides: Partial<SplitContainerLimits> = {},
  participantId = "participant-a",
) {
  return {
    runId: "run-a",
    participantId,
    attemptId: `attempt-${roots.length}`,
    image: TEST_IMAGE,
    workspacePath,
    user: { uid: 65_532, gid: 65_532 },
    limits: { ...limits, ...overrides },
  };
}

async function start(
  root: string,
  workspacePath: string,
  overrides: Partial<SplitContainerLimits> = {},
  participantId = "participant-a",
) {
  const runtime = new SplitRuntimeContainer(root, engine);
  const manifest = await runtime.start(request(workspacePath, overrides, participantId));
  containers.add(manifest.containerId);
  return { manifest, runtime };
}

function text(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("utf8");
}

afterEach(async () => {
  delete process.env.CODE_NEST_WORKER_SECRET;
  await Promise.all([...containers].map(async (containerId) => {
    try { await engine.remove(containerId); } catch { /* already removed */ }
  }));
  containers.clear();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("split-runtime participant container", () => {
  it("executes repository work inside the complete inspected isolation policy", async () => {
    process.env.CODE_NEST_WORKER_SECRET = "must-stay-in-control-plane";
    const { root, workspace, otherWorkspace } = await fixture();
    const { manifest, runtime } = await start(root, workspace);

    expect(manifest).toMatchObject({
      executionMode: "split",
      imageDigest: TEST_IMAGE.slice(TEST_IMAGE.indexOf("@") + 1),
      networkMode: "none",
      user: { uid: 65_532, gid: 65_532 },
      rootFilesystemReadOnly: true,
      privileged: false,
      capabilityDrops: ["ALL"],
      noNewPrivileges: true,
      seccompProfile: "builtin",
    });
    expect(JSON.stringify(manifest)).not.toContain(workspace);
    expect(JSON.stringify(manifest)).not.toContain("must-stay-in-control-plane");

    const command = await runtime.execute({
      executable: "/bin/sh",
      arguments: ["-c", [
        "id -u",
        "cat /workspace/brief.txt",
        "! touch /etc/code-nest-probe 2>/dev/null",
        "test ! -e /var/run/docker.sock",
        `test ! -e ${JSON.stringify(join(otherWorkspace, "private.txt"))}`,
        "test -z \"${CODE_NEST_WORKER_SECRET+x}\"",
        "grep -q 'lo:' /proc/net/dev",
        "! grep -q 'eth0:' /proc/net/dev",
        "printf changed > /workspace/change.txt",
      ].join(" && ")],
    });
    expect(command.exitCode, `${text(command.stdout)}\n${text(command.stderr)}`).toBe(0);
    expect(text(command.stdout)).toContain("65532\nauthorized participant seed");
    expect(text(command.stderr)).toBe("");
    expect(otherWorkspace).not.toBe("");

    await runtime.freeze();
    await expect(runtime.execute({ executable: "true" }))
      .rejects.toMatchObject({ code: "CONTAINER_NOT_RUNNING" });
    await runtime.thaw();
    const changed = await runtime.execute({ executable: "cat", arguments: ["change.txt"] });
    expect(text(changed.stdout)).toBe("changed");
    await expect(access(join(workspace, "change.txt"))).rejects.toThrow();

    const report = await runtime.stop("phase_complete");
    containers.delete(manifest.containerId);
    expect(report).toMatchObject({ status: "stopped", stopReason: "phase_complete", commandsCompleted: 2 });
    await expect(engine.inspect(manifest.containerId)).rejects.toMatchObject({
      code: "CONTAINER_ENGINE_FAILURE",
    });
  }, 20_000);

  it("returns participant command failures without confusing them with engine failure", async () => {
    const { root, workspace } = await fixture();
    const { manifest, runtime } = await start(root, workspace);

    const failed = await runtime.execute({
      executable: "/bin/sh",
      arguments: ["-c", "printf expected-error >&2; exit 7"],
    });
    expect(failed.exitCode).toBe(7);
    expect(text(failed.stderr)).toBe("expected-error");
    await expect(runtime.execute({ executable: "true" })).resolves.toMatchObject({ exitCode: 0 });

    await runtime.stop("done");
    containers.delete(manifest.containerId);
  }, 20_000);

  it("gives concurrent participants distinct containers and writable workspaces", async () => {
    const { root, workspace, otherWorkspace } = await fixture();
    const [first, second] = await Promise.all([
      start(root, workspace),
      start(root, otherWorkspace, {}, "participant-b"),
    ]);
    expect(first.manifest.containerId).not.toBe(second.manifest.containerId);

    const [firstSeed, secondSeed] = await Promise.all([
      first.runtime.execute({ executable: "cat", arguments: ["brief.txt"] }),
      second.runtime.execute({ executable: "cat", arguments: ["private.txt"] }),
    ]);
    expect(text(firstSeed.stdout)).toBe("authorized participant seed\n");
    expect(text(secondSeed.stdout)).toBe("other participant secret\n");

    await Promise.all([
      first.runtime.stop("done"),
      second.runtime.stop("done"),
    ]);
    containers.delete(first.manifest.containerId);
    containers.delete(second.manifest.containerId);
  }, 20_000);

  it("destroys a worker whose command exceeds its deadline", async () => {
    const { root, workspace } = await fixture();
    const { manifest, runtime } = await start(root, workspace, {
      commandTimeoutMilliseconds: 50,
    });

    await expect(runtime.execute({ executable: "sleep", arguments: ["2"] }))
      .rejects.toMatchObject({ code: "CONTAINER_COMMAND_LIMIT" });
    containers.delete(manifest.containerId);
    await expect(engine.inspect(manifest.containerId)).rejects.toMatchObject({
      code: "CONTAINER_ENGINE_FAILURE",
    });
  }, 20_000);

  it("rejects unpinned, root, escaped, and oversized input before Docker", async () => {
    const { root, workspace } = await fixture();
    const base = request(workspace);
    expect(() => normalizeSplitContainerRequest({ ...base, image: "alpine:latest" }, root))
      .toThrowError(expect.objectContaining({ code: "INVALID_CONTAINER_INPUT" }));
    expect(() => normalizeSplitContainerRequest({ ...base, user: { uid: 0, gid: 0 } }, root))
      .toThrowError(expect.objectContaining({ code: "INVALID_CONTAINER_INPUT" }));
    expect(() => normalizeSplitContainerRequest({ ...base, workspacePath: tmpdir() }, root))
      .toThrowError(expect.objectContaining({ code: "INVALID_CONTAINER_INPUT" }));
    expect(() => normalizeSplitContainerRequest({
      ...base,
      limits: { ...limits, workspaceBytes: 8 * MEBIBYTE, maximumFileBytes: 9 * MEBIBYTE },
    }, root)).toThrowError(expect.objectContaining({ code: "INVALID_CONTAINER_INPUT" }));
  });
});
