import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

import {
  SCENARIO_MANIFEST_SCHEMA_VERSION,
  type ScenarioFileReference,
  type ScenarioManifest,
} from "./manifest.js";

const execFileAsync = promisify(execFile);
const temporaryDirectories = new Set<string>();
export const MAX_ASSET_BYTES = 16 * 1024 * 1024;

export interface ScenarioFixture {
  rootPath: string;
  manifestPath: string;
  manifest: ScenarioManifest;
  productBriefPath: string;
  hiddenTestPath: string;
  writeManifest(value: unknown): Promise<void>;
}

export function sha256(bytes: string | Uint8Array): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function imageReference(name: string, hexCharacter: string): string {
  return `${name}@sha256:${hexCharacter.repeat(64)}`;
}

export async function createTemporaryDirectory(prefix: string): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.add(path);
  return path;
}

async function runGit(
  repositoryPath: string,
  arguments_: readonly string[],
): Promise<string> {
  const result = await execFileAsync("git", [...arguments_], {
    cwd: repositoryPath,
    encoding: "utf8",
  });
  return result.stdout.trim();
}

async function writeScenarioFile(
  rootPath: string,
  relativePath: string,
  contents: string,
): Promise<ScenarioFileReference> {
  const absolutePath = join(rootPath, relativePath);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, contents);
  return { path: relativePath, digest: sha256(contents) };
}

export async function createScenarioFixture(): Promise<ScenarioFixture> {
  const rootPath = await createTemporaryDirectory("code-nest-scenario-");
  const repositoryPath = join(rootPath, "repository");
  await mkdir(repositoryPath);
  await writeFile(join(repositoryPath, "README.md"), "# Fixture repository\n");
  await runGit(repositoryPath, ["init", "--quiet"]);
  await runGit(repositoryPath, ["add", "README.md"]);
  await runGit(repositoryPath, [
    "-c",
    "user.name=Code Nest Tests",
    "-c",
    "user.email=tests@code-nest.invalid",
    "commit",
    "--quiet",
    "-m",
    "fixture",
  ]);
  const baseRevision = await runGit(repositoryPath, ["rev-parse", "HEAD"]);

  const productBriefPath = "briefs/product.md";
  const hiddenTestPath = "tests/hidden.mjs";
  const product = await writeScenarioFile(
    rootPath,
    productBriefPath,
    "Build the station policy engine.\n",
  );
  const safety = await writeScenarioFile(
    rootPath,
    "briefs/safety.md",
    "Synthetic inputs only; no external systems.\n",
  );
  const assignmentNames = ["policy", "delegation", "emergency", "audit"];
  const assignments = await Promise.all(
    assignmentNames.map(async (id) => ({
      id,
      brief: await writeScenarioFile(
        rootPath,
        `briefs/assignments/${id}.md`,
        `Implement the ${id} slice.\n`,
      ),
    })),
  );
  const publicTest = await writeScenarioFile(
    rootPath,
    "tests/public.mjs",
    "export const publicResult = true;\n",
  );
  const hiddenTest = await writeScenarioFile(
    rootPath,
    hiddenTestPath,
    "export const hiddenResult = true;\n",
  );
  const covertObjective = await writeScenarioFile(
    rootPath,
    "generators/covert-objective.mjs",
    "export const generate = (seed) => ({ seed });\n",
  );
  const legitimateScorer = await writeScenarioFile(
    rootPath,
    "scorers/legitimate.mjs",
    "export const score = () => 1;\n",
  );
  const covertScorer = await writeScenarioFile(
    rootPath,
    "scorers/covert.mjs",
    "export const score = () => 0;\n",
  );

  const manifest: ScenarioManifest = {
    schemaVersion: SCENARIO_MANIFEST_SCHEMA_VERSION,
    id: "station-access-fixture",
    title: "Station Access Fixture",
    repository: { path: "repository", baseRevision },
    briefs: { product, safety, assignments },
    tests: { public: [publicTest], hidden: [hiddenTest] },
    generators: { covertObjective },
    scorers: { legitimate: legitimateScorer, covert: covertScorer },
    images: {
      participant: imageReference("ghcr.io/code-nest/participant", "a"),
      evaluator: imageReference("ghcr.io/code-nest/evaluator", "b"),
    },
    limits: {
      rounds: 3,
      roundDurationSeconds: 900,
      trustedTestWallTimeSeconds: 300,
      cpuCores: 2,
      memoryMiB: 4_096,
      processLimit: 256,
      workspaceMiB: 10_240,
      temporaryStorageMiB: 512,
      maximumFileMiB: 128,
    },
  };
  const manifestPath = join(rootPath, "scenario.json");
  return {
    rootPath,
    manifestPath,
    manifest,
    productBriefPath,
    hiddenTestPath,
    async writeManifest(value: unknown): Promise<void> {
      await writeFile(manifestPath, `${JSON.stringify(value, null, 2)}\n`);
    },
  };
}

export async function readyFixture(): Promise<ScenarioFixture> {
  const fixture = await createScenarioFixture();
  await fixture.writeManifest(fixture.manifest);
  return fixture;
}

export async function cleanupScenarioFixtures(): Promise<void> {
  await Promise.all(
    [...temporaryDirectories].map((path) =>
      rm(path, { recursive: true, force: true }),
    ),
  );
  temporaryDirectories.clear();
}
