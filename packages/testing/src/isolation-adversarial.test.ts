import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import images from "../../../docker/images.json";
import {
  ContainedRuntime,
  DockerContainedRuntimeEngine,
  DockerSplitContainerEngine,
  NodeDockerCommandRunner,
  SplitRuntimeContainer,
  type SplitContainerLimits,
} from "../../../apps/controller/src/containers/index.js";
import { EventLedger, type EventDraft } from "../../../apps/controller/src/ledger/ledger.js";

const MEBIBYTE = 1_048_576;
const RUN_ID = "run-adversarial";
const SEEDED_SECRET = "seeded-public-redaction-secret-marker";
const PROVIDER_SECRET_A = "Bearer provider-secret-participant-a";
const PROVIDER_SECRET_B = "Bearer provider-secret-participant-b";
const projectRoot = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const roots: string[] = [];
const docker = new NodeDockerCommandRunner();
const splitEngine = new DockerSplitContainerEngine(docker);
const containedEngine = new DockerContainedRuntimeEngine(docker);

const limits: SplitContainerLimits = {
  cpuCount: 0.25,
  memoryBytes: 64 * MEBIBYTE,
  processCount: 32,
  workspaceBytes: 8 * MEBIBYTE,
  homeBytes: 2 * MEBIBYTE,
  temporaryBytes: 2 * MEBIBYTE,
  maximumFileBytes: MEBIBYTE,
  commandTimeoutMilliseconds: 5_000,
  maximumOutputBytes: 64 * 1_024,
  stopGraceSeconds: 1,
};

function text(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("utf8");
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "code-nest-adversarial-"));
  const workspaces = join(root, "workspaces");
  const first = join(workspaces, "participant-a");
  const second = join(workspaces, "participant-b");
  const hidden = join(root, "hidden-tests");
  const controller = join(root, "controller-storage");
  await Promise.all([first, second, hidden, controller].map((path) => mkdir(path, { recursive: true })));
  await Promise.all([
    writeFile(join(first, "public.txt"), "participant a\n", "utf8"),
    writeFile(join(second, "private.txt"), "participant b private\n", "utf8"),
    writeFile(join(hidden, "release.test.mjs"), "hidden-test-source-marker\n", "utf8"),
    writeFile(join(controller, "events.sqlite"), "controller-private-marker\n", "utf8"),
  ]);
  roots.push(root);
  return { root, workspaces, first, second, hidden, controller };
}

async function splitRuntime(
  workspaceRoot: string,
  workspacePath: string,
  participantId: string,
  overrides: Partial<SplitContainerLimits> = {},
) {
  const runtime = new SplitRuntimeContainer(workspaceRoot, splitEngine);
  const manifest = await runtime.start({
    runId: RUN_ID,
    participantId,
    attemptId: `attempt-${participantId}`,
    image: images.splitWorker,
    workspacePath,
    user: { uid: 65_532, gid: 65_532 },
    limits: { ...limits, ...overrides },
  });
  return { runtime, manifest };
}

async function containedRuntime(
  values: Awaited<ReturnType<typeof fixture>>,
  participantId: string,
  workspacePath: string,
  providerSecret: string,
) {
  const runtime = new ContainedRuntime(containedEngine, {
    allowedWorkspaceRoot: values.workspaces,
    brokerSourcePath: join(projectRoot, "apps/controller/src/credentials"),
    trustedCodeRoot: projectRoot,
  }, {
    secrets: {
      grantId: () => `grant-${participantId}`,
      token: () => `gateway-token-${participantId}-0123456789abcdef`,
    },
    clock: { now: () => new Date("2029-01-01T00:00:00.000Z") },
  });
  const manifest = await runtime.start({
    runId: RUN_ID,
    participantId,
    attemptId: `attempt-${participantId}`,
    agentImage: images.splitWorker,
    brokerImage: images.credentialBroker,
    workspacePath,
    user: { uid: 65_532, gid: 65_532 },
    provider: {
      providerId: "provider-a",
      baseUrl: "https://provider.invalid/",
      allowedPathPrefixes: ["/v1/messages"],
      credentialHeader: "authorization",
      credentialValue: providerSecret,
    },
    limits,
    grantLifetimeMilliseconds: 60 * 60_000,
  });
  return { runtime, manifest };
}

async function listed(kind: "container" | "network" | "volume"): Promise<string[]> {
  const result = await docker.run([kind, "ls", "--quiet", "--filter", `label=code-nest.run-id=${RUN_ID}`]);
  return text(result.stdout).trim().split("\n").filter(Boolean);
}

async function cleanupDocker(): Promise<void> {
  for (const id of await listed("container")) {
    try { await docker.run(["container", "rm", "--force", "--volumes", id]); } catch { /* cleaned */ }
  }
  for (const kind of ["network", "volume"] as const) {
    for (const id of await listed(kind)) {
      try { await docker.run([kind, "rm", id]); } catch { /* cleaned */ }
    }
  }
}

afterEach(async () => {
  delete process.env.OPENAI_API_KEY;
  await cleanupDocker();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("adversarial isolation, redaction, and cleanup", () => {
  it("denies host, hidden, credential, socket, peer-workspace, and writable-root access", async () => {
    process.env.OPENAI_API_KEY = SEEDED_SECRET;
    const values = await fixture();
    const [first, second] = await Promise.all([
      splitRuntime(values.workspaces, values.first, "participant-a"),
      splitRuntime(values.workspaces, values.second, "participant-b"),
    ]);
    const attack = await first.runtime.execute({
      executable: "/bin/sh",
      arguments: ["-c", [
        `test ! -e ${JSON.stringify(join(values.second, "private.txt"))}`,
        `test ! -e ${JSON.stringify(join(values.hidden, "release.test.mjs"))}`,
        `test ! -e ${JSON.stringify(join(values.controller, "events.sqlite"))}`,
        "test ! -e /opt/code-nest/evaluator/run.mjs",
        "test ! -e /var/run/docker.sock",
        `! env | grep -F ${JSON.stringify(SEEDED_SECRET)}`,
        `! tr '\\0' '\\n' < /proc/1/environ | grep -F ${JSON.stringify(SEEDED_SECRET)}`,
        "! touch /etc/adversarial-probe 2>/dev/null",
        "grep -q 'lo:' /proc/net/dev && ! grep -q 'eth0:' /proc/net/dev",
        "dd if=/dev/zero of=/workspace/limit.bin bs=1M count=4 2>/dev/null || true",
        `test "$(wc -c < /workspace/limit.bin)" -le ${MEBIBYTE}`,
      ].join(" && ")],
    });
    expect(attack.exitCode, `${text(attack.stdout)}\n${text(attack.stderr)}`).toBe(0);
    await first.runtime.stop("phase_complete");
    await second.runtime.stop("operator_cancelled");
    await expect(splitEngine.inspect(first.manifest.containerId)).rejects.toMatchObject({ code: "CONTAINER_ENGINE_FAILURE" });
    expect(await listed("container")).toEqual([]);
    expect(await listed("volume")).toEqual([]);
  }, 60_000);

  it("terminates and removes a participant that exhausts its output allowance", async () => {
    const values = await fixture();
    const { runtime, manifest } = await splitRuntime(values.workspaces, values.first, "participant-a", {
      maximumOutputBytes: 1_024,
    });
    await expect(runtime.execute({ executable: "yes", arguments: ["bounded-output"] }))
      .rejects.toMatchObject({ code: "CONTAINER_COMMAND_LIMIT" });
    await expect(splitEngine.inspect(manifest.containerId)).rejects.toMatchObject({ code: "CONTAINER_ENGINE_FAILURE" });
    expect(await listed("container")).toEqual([]);
  }, 30_000);

  it("blocks contained participants from peer brokers and direct internet, then removes both networks", async () => {
    const values = await fixture();
    const first = await containedRuntime(values, "participant-a", values.first, PROVIDER_SECRET_A);
    const second = await containedRuntime(values, "participant-b", values.second, PROVIDER_SECRET_B);
    const address = await docker.run([
      "network", "inspect", "--format",
      `{{with index .Containers "${second.manifest.brokerContainerId}"}}{{.IPv4Address}}{{end}}`,
      second.manifest.privateNetworkId,
    ]);
    const peerAddress = text(address.stdout).trim().split("/")[0] ?? "";
    expect(peerAddress).toMatch(/^\d+\.\d+\.\d+\.\d+$/u);
    const attack = await first.runtime.execute({
      executable: "/bin/sh",
      arguments: ["-c", [
        `timeout 1 wget -qO- http://${peerAddress}:4317/health/live >/dev/null 2>&1; peer=$?`,
        "timeout 1 wget -qO- http://1.1.1.1 >/dev/null 2>&1; internet=$?",
        `! env | grep -F ${JSON.stringify(PROVIDER_SECRET_A)}`,
        `test ! -e ${JSON.stringify(join(values.hidden, "release.test.mjs"))}`,
        "test $peer -ne 0 && test $internet -ne 0",
      ].join("; ")],
    });
    expect(attack.exitCode, text(attack.stderr)).toBe(0);
    await first.runtime.stop("match_complete");
    await second.runtime.stop("operator_cancelled");
    expect(await listed("container")).toEqual([]);
    expect(await listed("network")).toEqual([]);
  }, 60_000);

  it("redacts a seeded secret before a public event reaches SQLite", async () => {
    const values = await fixture();
    const databasePath = join(values.root, "ledger", "events.sqlite");
    await mkdir(dirname(databasePath), { recursive: true });
    const ledger = EventLedger.open(databasePath, { secretPatterns: [SEEDED_SECRET] });
    const draft: EventDraft = {
      schemaVersion: "1.0",
      eventId: "evt-redacted",
      runId: RUN_ID,
      recordedAt: "2026-09-18T12:00:00.000Z",
      actor: { kind: "runtime", id: "participant-a" },
      context: { round: 1, phase: "work" },
      kind: "runtime.output",
      payload: {
        message: `prefix ${SEEDED_SECRET} suffix`,
        nested: [{ [`field-${SEEDED_SECRET}`]: SEEDED_SECRET }],
      },
      visibility: { class: "public" },
      causationId: "cmd-redacted",
      correlationId: "corr-redacted",
      parentEventIds: [],
      artifactDigests: [],
      resourceCost: {},
    };
    const result = ledger.appendCommandEvent("cmd-redacted", draft);
    expect(JSON.stringify(result.event)).not.toContain(SEEDED_SECRET);
    expect(JSON.stringify(result.event)).toContain("[REDACTED]");
    ledger.close();
    const files = await readdir(dirname(databasePath));
    const persisted = Buffer.concat(await Promise.all(files.map((name) => readFile(join(dirname(databasePath), name)))));
    expect(persisted.includes(Buffer.from(SEEDED_SECRET))).toBe(false);
  });
});
