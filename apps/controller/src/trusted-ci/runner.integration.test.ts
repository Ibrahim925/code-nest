import { createHash, createHmac } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import images from "../../../../docker/images.json";
import { GitCandidateFreezer } from "../matches/adapters/git-candidate-freezer.js";
import { NodeDockerCommandRunner } from "../containers/index.js";
import {
  DockerTrustedContainerEngine,
  TrustedTestRunner,
  type TrustedTestReport,
  type TrustedTestRequest,
} from "./index.js";

const executeFile = promisify(execFile);
const MEBIBYTE = 1_048_576;
const RUN_ID = "run-trusted-test";
const HIDDEN_MARKER = "hidden-evaluator-detail-marker";
const HOST_SECRET = "host-provider-secret-marker";
const SIGNING_KEY = Buffer.alloc(32, 7);
const projectRoot = dirname(dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url))))));
const evaluatorPath = join(projectRoot, "apps/controller/src/trusted-ci/trusted-evaluator.test-fixture.mjs");
const roots: string[] = [];
const docker = new NodeDockerCommandRunner();

async function git(path: string, arguments_: readonly string[]): Promise<string> {
  const { stdout } = await executeFile("git", [...arguments_], {
    cwd: path,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_AUTHOR_NAME: "Code Nest Test",
      GIT_AUTHOR_EMAIL: "test@code-nest.invalid",
      GIT_COMMITTER_NAME: "Code Nest Test",
      GIT_COMMITTER_EMAIL: "test@code-nest.invalid",
    },
  });
  return stdout.trim();
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "code-nest-trusted-ci-"));
  const candidateRoot = join(root, "candidates");
  const candidatePath = join(candidateRoot, "candidate-a");
  await mkdir(candidatePath, { recursive: true });
  await writeFile(join(candidatePath, "value.txt"), "authorized candidate\n", "utf8");
  await git(candidatePath, ["init", "--quiet"]);
  await git(candidatePath, ["add", "value.txt"]);
  await git(candidatePath, ["commit", "--quiet", "-m", "candidate"]);
  const candidateRevision = await git(candidatePath, ["rev-parse", "HEAD"]);
  const candidate = await new GitCandidateFreezer().freeze({ candidatePath, candidateRevision });
  const evaluatorDigest = `sha256:${createHash("sha256").update(await readFile(evaluatorPath)).digest("hex")}`;
  roots.push(root);
  return { root, candidateRoot, candidatePath, candidateRevision, candidate, evaluatorDigest };
}

function request(
  values: Awaited<ReturnType<typeof fixture>>,
  jobId: string,
  disclosure: "aggregate" | "public",
): TrustedTestRequest {
  return {
    runId: RUN_ID,
    jobId,
    candidatePath: values.candidatePath,
    candidateRevision: values.candidateRevision,
    candidateDigest: values.candidate.candidateDigest,
    evaluatorPath,
    evaluatorDigest: values.evaluatorDigest,
    evaluatorImage: images.trustedEvaluator,
    disclosure,
    user: { uid: 65_532, gid: 65_532 },
    limits: {
      cpuCount: 0.25,
      memoryBytes: 64 * MEBIBYTE,
      processCount: 32,
      workspaceBytes: 8 * MEBIBYTE,
      temporaryBytes: 2 * MEBIBYTE,
      maximumFileBytes: 4 * MEBIBYTE,
      wallTimeMilliseconds: 10_000,
      maximumOutputBytes: 64 * 1_024,
      stopGraceSeconds: 1,
    },
  };
}

function signatureIsValid(report: TrustedTestReport): boolean {
  const { signature, ...unsigned } = report;
  const expected = `hmac-sha256:${createHmac("sha256", SIGNING_KEY).update(JSON.stringify(unsigned)).digest("hex")}`;
  return signature === expected;
}

async function managedContainers(): Promise<string> {
  const result = await docker.run([
    "container", "ls", "--all", "--quiet", "--filter", `label=code-nest.run-id=${RUN_ID}`,
  ]);
  return Buffer.from(result.stdout).toString("utf8").trim();
}

afterEach(async () => {
  delete process.env.OPENAI_API_KEY;
  const ids = await managedContainers();
  for (const id of ids.split("\n").filter(Boolean)) {
    try { await docker.run(["container", "rm", "--force", "--volumes", id]); } catch { /* cleaned */ }
  }
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("disposable trusted-test containers", () => {
  it("runs fresh public and hidden jobs while returning only authorized signed fields", async () => {
    process.env.OPENAI_API_KEY = HOST_SECRET;
    const values = await fixture();
    const runner = new TrustedTestRunner(
      new DockerTrustedContainerEngine(docker),
      { candidateRoot: values.candidateRoot, evaluatorRoot: projectRoot },
      SIGNING_KEY,
    );
    const publicReport = await runner.run(request(values, "public-job", "public"));
    const hiddenReport = await runner.run(request(values, "hidden-job", "aggregate"));

    expect(publicReport).toMatchObject({
      outcome: "passed",
      disclosure: "public",
      candidateDigest: values.candidate.candidateDigest,
      evaluatorImageDigest: images.trustedEvaluator.split("@")[1],
      evaluatorDigest: values.evaluatorDigest,
      passedChecks: 2,
      failedChecks: 0,
      checks: [{ checkId: "candidate-content", passed: true }],
    });
    expect(hiddenReport).toMatchObject({ outcome: "passed", disclosure: "aggregate", passedChecks: 2, failedChecks: 0 });
    expect("checks" in hiddenReport).toBe(false);
    expect(signatureIsValid(publicReport)).toBe(true);
    expect(signatureIsValid(hiddenReport)).toBe(true);
    const serialized = JSON.stringify([publicReport, hiddenReport]);
    expect(serialized).not.toContain(HIDDEN_MARKER);
    expect(serialized).not.toContain("hidden-access-rule");
    expect(serialized).not.toContain(HOST_SECRET);
    expect(serialized).not.toContain(values.candidatePath);
    expect(serialized).not.toContain(evaluatorPath);
    expect(await managedContainers()).toBe("");
  }, 60_000);

  it("rejects altered material and unsafe configuration before a report exists", async () => {
    const values = await fixture();
    const runner = new TrustedTestRunner(
      new DockerTrustedContainerEngine(docker),
      { candidateRoot: values.candidateRoot, evaluatorRoot: projectRoot },
      SIGNING_KEY,
    );
    await writeFile(join(values.candidatePath, "uncommitted.txt"), "changed\n", "utf8");
    await expect(runner.run(request(values, "changed-job", "aggregate")))
      .rejects.toMatchObject({ code: "TRUSTED_CI_MATERIAL_MISMATCH" });
    await expect(runner.run({
      ...request(values, "unpinned-job", "aggregate"),
      evaluatorImage: "node:latest",
    })).rejects.toMatchObject({ code: "TRUSTED_CI_INVALID_INPUT" });
    await expect(runner.run({
      ...request(values, "escaped-job", "aggregate"),
      evaluatorPath: join(tmpdir(), "outside-evaluator.mjs"),
    })).rejects.toMatchObject({ code: "TRUSTED_CI_INVALID_INPUT" });
    expect(await managedContainers()).toBe("");
  }, 30_000);
});
