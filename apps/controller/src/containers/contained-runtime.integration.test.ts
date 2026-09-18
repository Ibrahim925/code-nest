import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import images from "../../../../docker/images.json";
import {
  ContainedRuntime,
  DockerContainedRuntimeEngine,
  NodeDockerCommandRunner,
} from "./index.js";

const executeFile = promisify(execFile);
const MEBIBYTE = 1_048_576;
const RUN_ID = "run-contained-test";
const TOKEN = "contained_capability_token_0123456789abcdef";
const LONG_CREDENTIAL = "Bearer long-lived-provider-secret-marker";
const PROMPT = "prompt-body-private-marker";
const projectRoot = dirname(dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url))))));
const roots: string[] = [];
const runner = new NodeDockerCommandRunner();
const engine = new DockerContainedRuntimeEngine(runner);

function text(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("utf8");
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "code-nest-contained-"));
  const workspace = join(root, RUN_ID, "participant-a");
  const tls = join(root, "tls");
  await mkdir(workspace, { recursive: true });
  await mkdir(tls, { recursive: true });
  await writeFile(join(workspace, "task.txt"), "contained agent task\n", "utf8");
  const openssl = join(root, "openssl.cnf");
  await writeFile(openssl, [
    "[req]", "distinguished_name=dn", "x509_extensions=v3", "prompt=no",
    "[dn]", "CN=provider-stub",
    "[v3]", "subjectAltName=DNS:provider-stub", "keyUsage=digitalSignature,keyEncipherment",
    "extendedKeyUsage=serverAuth",
  ].join("\n"), "utf8");
  await executeFile("openssl", [
    "req", "-x509", "-newkey", "rsa:2048", "-nodes",
    "-keyout", join(tls, "key.pem"), "-out", join(tls, "cert.pem"),
    "-days", "1", "-config", openssl,
  ]);
  roots.push(root);
  return { root, workspace, tls, certificate: await readFile(join(tls, "cert.pem"), "utf8") };
}

async function createProviderStub(egressNetworkId: string, tls: string): Promise<string> {
  const environmentPath = join(tls, "provider.env");
  await writeFile(environmentPath, `EXPECTED_PROVIDER_CREDENTIAL=${LONG_CREDENTIAL}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  const source = join(projectRoot, "apps/controller/src/credentials/provider-stub.test-fixture.mjs");
  const result = await runner.run([
    "container", "create",
    "--name", `code-nest-provider-${RUN_ID}`,
    "--network", egressNetworkId,
    "--network-alias", "provider-stub",
    "--pull", "never",
    "--read-only",
    "--cap-drop", "ALL",
    "--security-opt", "no-new-privileges=true",
    "--security-opt", "seccomp=builtin",
    "--user", "1000:1000",
    "--memory", `${64 * MEBIBYTE}b`,
    "--memory-swap", `${64 * MEBIBYTE}b`,
    "--cpus", "0.25",
    "--pids-limit", "32",
    "--tmpfs", `/tmp:rw,nosuid,nodev,noexec,size=${2 * MEBIBYTE},uid=1000,gid=1000,mode=0700`,
    "--mount", `type=bind,src=${source},dst=/opt/code-nest/provider-stub.mjs,readonly`,
    "--mount", `type=bind,src=${tls},dst=/opt/code-nest/tls,readonly`,
    "--env-file", environmentPath,
    "--init",
    "--restart", "no",
    "--log-driver", "local",
    "--log-opt", "max-size=1m",
    "--log-opt", "max-file=2",
    "--label", "code-nest.managed=true",
    "--label", `code-nest.run-id=${RUN_ID}`,
    "--entrypoint", "node",
    images.credentialBroker,
    "/opt/code-nest/provider-stub.mjs",
  ]);
  await rm(environmentPath, { force: true });
  const id = text(result.stdout).trim();
  await runner.run(["container", "start", id]);
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const logs = await runner.run(["container", "logs", id]);
    if (text(logs.stdout).includes("provider_ready")) return id;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Provider stub did not become ready.");
}

async function cleanupDocker(): Promise<void> {
  const containers = await runner.run([
    "container", "ls", "--all", "--quiet", "--filter", `label=code-nest.run-id=${RUN_ID}`,
  ]);
  for (const id of text(containers.stdout).trim().split("\n").filter(Boolean)) {
    try { await runner.run(["container", "rm", "--force", "--volumes", id]); } catch { /* cleaned */ }
  }
  const networks = await runner.run([
    "network", "ls", "--quiet", "--filter", `label=code-nest.run-id=${RUN_ID}`,
  ]);
  for (const id of text(networks.stdout).trim().split("\n").filter(Boolean)) {
    try { await runner.run(["network", "rm", id]); } catch { /* cleaned */ }
  }
}

afterEach(async () => {
  await cleanupDocker();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("contained runtime with controlled provider egress", () => {
  it("routes only an authenticated approved request through the credential broker", async () => {
    const { root, workspace, tls, certificate } = await fixture();
    const runtime = new ContainedRuntime(engine, {
      allowedWorkspaceRoot: root,
      brokerSourcePath: join(projectRoot, "apps/controller/src/credentials"),
      trustedCodeRoot: projectRoot,
    }, {
      secrets: { grantId: () => "grant-contained", token: () => TOKEN },
      clock: { now: () => new Date("2029-01-01T00:00:00.000Z") },
    });
    const manifest = await runtime.start({
      runId: RUN_ID,
      participantId: "participant-a",
      attemptId: "attempt-a",
      agentImage: images.splitWorker,
      brokerImage: images.credentialBroker,
      workspacePath: workspace,
      user: { uid: 65_532, gid: 65_532 },
      provider: {
        providerId: "provider-a",
        baseUrl: "https://provider-stub:8443/",
        allowedPathPrefixes: ["/v1/messages"],
        credentialHeader: "authorization",
        credentialValue: LONG_CREDENTIAL,
        certificateAuthority: certificate,
      },
      limits: {
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
      },
      grantLifetimeMilliseconds: 60_000,
    });
    const providerId = await createProviderStub(manifest.egressNetworkId, tls);
    expect(JSON.stringify(manifest)).not.toContain(TOKEN);
    expect(JSON.stringify(manifest)).not.toContain(LONG_CREDENTIAL);
    expect(manifest).toMatchObject({
      executionMode: "contained",
      providerHostname: "provider-stub",
      networkPolicy: {
        participantDirectEgress: false,
        participantPeerAccess: false,
        brokerRequired: true,
      },
    });

    const allowed = await runtime.execute({
      executable: "/bin/sh",
      arguments: ["-c", [
        "wget -qO-",
        "--header=\"Authorization: Bearer $CODE_NEST_GATEWAY_TOKEN\"",
        "--header=\"Content-Type: application/json\"",
        `--post-data=${JSON.stringify(PROMPT)}`,
        "\"$CODE_NEST_GATEWAY_URL/v1/providers/$CODE_NEST_PROVIDER_ID/v1/messages\"",
      ].join(" ")],
    });
    expect(allowed.exitCode, text(allowed.stderr)).toBe(0);
    expect(JSON.parse(text(allowed.stdout))).toMatchObject({
      authorized: true,
      method: "POST",
      path: "/v1/messages",
      requestBytes: Buffer.byteLength(PROMPT),
    });

    const blocked = await runtime.execute({
      executable: "/bin/sh",
      arguments: ["-c", [
        "timeout 1 wget -qO- https://provider-stub:8443/v1/messages >/dev/null 2>&1; provider_status=$?",
        "timeout 1 wget -qO- http://1.1.1.1 >/dev/null 2>&1; internet_status=$?",
        "test $provider_status -ne 0 && test $internet_status -ne 0",
      ].join("; ")],
    });
    expect(blocked.exitCode).toBe(0);
    const participantEnvironment = await runtime.execute({ executable: "env" });
    expect(text(participantEnvironment.stdout)).not.toContain(LONG_CREDENTIAL);

    const logs = text(await runtime.brokerLogs());
    expect(logs).toContain('"outcome":"allowed"');
    expect(logs).toContain('"providerId":"provider-a"');
    expect(logs).not.toContain(PROMPT);
    expect(logs).not.toContain(TOKEN);
    expect(logs).not.toContain(LONG_CREDENTIAL);

    await runner.run(["container", "rm", "--force", "--volumes", providerId]);
    const report = await runtime.stop("match_complete");
    expect(report).toMatchObject({ status: "stopped", commandsCompleted: 3 });
    await expect(engine.inspectNetwork(manifest.privateNetworkId)).rejects.toMatchObject({
      code: "CONTAINER_ENGINE_FAILURE",
    });
    await expect(engine.inspectNetwork(manifest.egressNetworkId)).rejects.toMatchObject({
      code: "CONTAINER_ENGINE_FAILURE",
    });
  }, 30_000);

  it("rejects unpinned broker images and insecure provider URLs before Docker", async () => {
    const { root, workspace } = await fixture();
    const runtime = new ContainedRuntime(engine, {
      allowedWorkspaceRoot: root,
      brokerSourcePath: join(projectRoot, "apps/controller/src/credentials"),
      trustedCodeRoot: projectRoot,
    });
    const base = {
      runId: RUN_ID,
      participantId: "participant-a",
      attemptId: "attempt-a",
      agentImage: images.splitWorker,
      brokerImage: "node:latest",
      workspacePath: workspace,
      user: { uid: 65_532, gid: 65_532 },
      provider: {
        providerId: "provider-a",
        baseUrl: "http://provider.example/",
        allowedPathPrefixes: ["/v1"],
        credentialHeader: "authorization",
        credentialValue: LONG_CREDENTIAL,
      },
    };
    await expect(runtime.start(base)).rejects.toMatchObject({ code: "INVALID_CONTAINER_INPUT" });
    await expect(runtime.start({
      ...base,
      brokerImage: images.credentialBroker,
    })).rejects.toMatchObject({ code: "INVALID_BROKER_INPUT" });
  });
});
