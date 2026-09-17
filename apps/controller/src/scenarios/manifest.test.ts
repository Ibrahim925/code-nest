import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  afterEach,
  describe,
  expect,
  it,
} from "vitest";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  truncate,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

import {
  loadScenarioManifest,
  SCENARIO_MANIFEST_SCHEMA_VERSION,
  ScenarioManifestError,
  type ScenarioFileReference,
  type ScenarioManifest,
} from "./manifest";

const execFileAsync = promisify(execFile);
const temporaryDirectories = new Set<string>();
const MAX_ASSET_BYTES = 16 * 1024 * 1024;

interface ScenarioFixture {
  rootPath: string;
  manifestPath: string;
  manifest: ScenarioManifest;
  productBriefPath: string;
  hiddenTestPath: string;
  writeManifest(value: unknown): Promise<void>;
}

function sha256(bytes: string | Uint8Array): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function imageReference(name: string, hexCharacter: string): string {
  return `${name}@sha256:${hexCharacter.repeat(64)}`;
}

async function createTemporaryDirectory(prefix: string): Promise<string> {
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

async function createScenarioFixture(): Promise<ScenarioFixture> {
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
    repository: {
      path: "repository",
      baseRevision,
    },
    briefs: {
      product,
      safety,
      assignments,
    },
    tests: {
      public: [publicTest],
      hidden: [hiddenTest],
    },
    generators: {
      covertObjective,
    },
    scorers: {
      legitimate: legitimateScorer,
      covert: covertScorer,
    },
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

async function readyFixture(): Promise<ScenarioFixture> {
  const fixture = await createScenarioFixture();
  await fixture.writeManifest(fixture.manifest);
  return fixture;
}

afterEach(async () => {
  await Promise.all(
    [...temporaryDirectories].map((path) =>
      rm(path, { recursive: true, force: true }),
    ),
  );
  temporaryDirectories.clear();
});

describe("pinned scenario manifest loading", () => {
  it("loads one fully pinned scenario and retains every verified asset", async () => {
    const fixture = await readyFixture();
    const manifestBytes = await readFile(fixture.manifestPath);

    const loaded = await loadScenarioManifest(fixture.manifestPath);

    expect(loaded.manifest).toEqual(fixture.manifest);
    expect(loaded.manifestDigest).toBe(sha256(manifestBytes));
    expect(Buffer.from(loaded.manifestBytes)).toEqual(manifestBytes);
    expect(loaded.manifestPath).toBe(await realpath(fixture.manifestPath));
    expect(loaded.rootPath).toBe(await realpath(fixture.rootPath));
    expect(loaded.repositoryPath).toBe(
      await realpath(join(fixture.rootPath, "repository")),
    );
    expect(loaded.assets).toHaveLength(11);
    expect(
      loaded.assets.map((asset) => asset.field).sort(),
    ).toEqual([
      "/briefs/assignments/0/brief",
      "/briefs/assignments/1/brief",
      "/briefs/assignments/2/brief",
      "/briefs/assignments/3/brief",
      "/briefs/product",
      "/briefs/safety",
      "/generators/covertObjective",
      "/scorers/covert",
      "/scorers/legitimate",
      "/tests/hidden/0",
      "/tests/public/0",
    ]);
    const hiddenTest = loaded.assets.find(
      (asset) => asset.reference.path === fixture.hiddenTestPath,
    );
    expect(Buffer.from(hiddenTest?.bytes ?? []).toString("utf8")).toBe(
      "export const hiddenResult = true;\n",
    );
  });

  it("keeps the verified bytes after the source file changes", async () => {
    const fixture = await readyFixture();
    const loaded = await loadScenarioManifest(fixture.manifestPath);
    await writeFile(
      join(fixture.rootPath, fixture.hiddenTestPath),
      "export const hiddenResult = false;\n",
    );

    const hiddenTest = loaded.assets.find(
      (asset) => asset.reference.path === fixture.hiddenTestPath,
    );
    expect(Buffer.from(hiddenTest?.bytes ?? []).toString("utf8")).toBe(
      "export const hiddenResult = true;\n",
    );
  });

  it("rejects malformed JSON before any scenario asset is trusted", async () => {
    const fixture = await createScenarioFixture();
    await writeFile(fixture.manifestPath, "{ definitely-not-json");

    await expect(loadScenarioManifest(fixture.manifestPath)).rejects.toMatchObject({
      name: "ScenarioManifestError",
      code: "INVALID_SCENARIO_MANIFEST",
      message: "Scenario manifest must contain valid UTF-8 JSON.",
    });
  });

  it("rejects an unsupported scenario schema version", async () => {
    const fixture = await readyFixture();
    await fixture.writeManifest({
      ...fixture.manifest,
      schemaVersion: "2.0",
    });

    await expect(loadScenarioManifest(fixture.manifestPath)).rejects.toMatchObject({
      code: "UNSUPPORTED_SCENARIO_SCHEMA",
    });
  });

  it("rejects unknown fields instead of silently ignoring them", async () => {
    const fixture = await readyFixture();
    await fixture.writeManifest({
      ...fixture.manifest,
      surpriseNetworkAccess: true,
    });

    await expect(loadScenarioManifest(fixture.manifestPath)).rejects.toMatchObject({
      code: "INVALID_SCENARIO_MANIFEST",
      field: "/",
    });
  });

  it.each([
    "../outside.md",
    "/etc/passwd",
    "briefs\\product.md",
    "briefs//product.md",
  ])("rejects the non-portable or escaping asset path %s", async (path) => {
    const fixture = await readyFixture();
    await fixture.writeManifest({
      ...fixture.manifest,
      briefs: {
        ...fixture.manifest.briefs,
        product: {
          ...fixture.manifest.briefs.product,
          path,
        },
      },
    });

    await expect(loadScenarioManifest(fixture.manifestPath)).rejects.toMatchObject({
      code: "UNSAFE_SCENARIO_PATH",
      field: "/briefs/product/path",
    });
  });

  it("rejects a symlink that resolves outside the scenario root", async () => {
    const fixture = await readyFixture();
    const outsideRoot = await createTemporaryDirectory("code-nest-outside-");
    const outsidePath = join(outsideRoot, "outside.md");
    const contents = "outside the scenario boundary\n";
    await writeFile(outsidePath, contents);
    await symlink(outsidePath, join(fixture.rootPath, "escape.md"));
    await fixture.writeManifest({
      ...fixture.manifest,
      briefs: {
        ...fixture.manifest.briefs,
        product: { path: "escape.md", digest: sha256(contents) },
      },
    });

    await expect(loadScenarioManifest(fixture.manifestPath)).rejects.toMatchObject({
      code: "UNSAFE_SCENARIO_PATH",
      field: "/briefs/product/path",
    });
  });

  it("rejects a missing referenced asset", async () => {
    const fixture = await readyFixture();
    await rm(join(fixture.rootPath, fixture.productBriefPath));

    await expect(loadScenarioManifest(fixture.manifestPath)).rejects.toMatchObject({
      code: "SCENARIO_ASSET_NOT_FOUND",
      field: "/briefs/product",
    });
  });

  it("rejects a directory presented as a scenario file", async () => {
    const fixture = await readyFixture();
    await rm(join(fixture.rootPath, fixture.productBriefPath));
    await mkdir(join(fixture.rootPath, fixture.productBriefPath));

    await expect(loadScenarioManifest(fixture.manifestPath)).rejects.toMatchObject({
      code: "SCENARIO_ASSET_NOT_FILE",
      field: "/briefs/product",
    });
  });

  it("rejects asset bytes that do not match their declared digest", async () => {
    const fixture = await readyFixture();
    await writeFile(
      join(fixture.rootPath, fixture.productBriefPath),
      "silently changed after pinning\n",
    );

    await expect(loadScenarioManifest(fixture.manifestPath)).rejects.toMatchObject({
      code: "SCENARIO_DIGEST_MISMATCH",
      field: "/briefs/product",
    });
  });

  it("rejects a malformed asset digest before resolving the file", async () => {
    const fixture = await readyFixture();
    await fixture.writeManifest({
      ...fixture.manifest,
      briefs: {
        ...fixture.manifest.briefs,
        product: {
          ...fixture.manifest.briefs.product,
          digest: "sha256:../../outside",
        },
      },
    });

    await expect(loadScenarioManifest(fixture.manifestPath)).rejects.toMatchObject({
      code: "INVALID_SCENARIO_MANIFEST",
      field: "/briefs/product/digest",
    });
  });

  it("rejects an asset larger than the loader's bounded read", async () => {
    const fixture = await readyFixture();
    await truncate(
      join(fixture.rootPath, fixture.productBriefPath),
      MAX_ASSET_BYTES + 1,
    );

    await expect(loadScenarioManifest(fixture.manifestPath)).rejects.toMatchObject({
      code: "SCENARIO_ASSET_TOO_LARGE",
      field: "/briefs/product",
    });
  });

  it("rejects assets that exceed the aggregate retained-byte limit", async () => {
    const fixture = await readyFixture();
    const assetSize = 13 * 1024 * 1024;
    const largeDigest = sha256(new Uint8Array(assetSize));
    const references = [
      fixture.manifest.briefs.product,
      fixture.manifest.briefs.safety,
      ...fixture.manifest.briefs.assignments
        .slice(0, 3)
        .map((assignment) => assignment.brief),
    ];
    await Promise.all(
      references.map(async (reference) => {
        const path = join(fixture.rootPath, reference.path);
        await truncate(path, 0);
        await truncate(path, assetSize);
      }),
    );
    await fixture.writeManifest({
      ...fixture.manifest,
      briefs: {
        product: { ...fixture.manifest.briefs.product, digest: largeDigest },
        safety: { ...fixture.manifest.briefs.safety, digest: largeDigest },
        assignments: fixture.manifest.briefs.assignments.map(
          (assignment, index) =>
            index < 3
              ? { ...assignment, brief: { ...assignment.brief, digest: largeDigest } }
              : assignment,
        ),
      },
    });

    await expect(loadScenarioManifest(fixture.manifestPath)).rejects.toMatchObject({
      code: "SCENARIO_ASSETS_TOO_LARGE",
      field: "/briefs/assignments/2/brief",
    });
  });

  it("rejects one file reused under two manifest fields", async () => {
    const fixture = await readyFixture();
    await fixture.writeManifest({
      ...fixture.manifest,
      briefs: {
        ...fixture.manifest.briefs,
        safety: fixture.manifest.briefs.product,
      },
    });

    await expect(loadScenarioManifest(fixture.manifestPath)).rejects.toMatchObject({
      code: "DUPLICATE_SCENARIO_ASSET",
      field: "/briefs/safety",
    });
  });

  it.each([
    {
      name: "three assignments",
      assignments: (manifest: ScenarioManifest) =>
        manifest.briefs.assignments.slice(0, 3),
    },
    {
      name: "a repeated assignment ID",
      assignments: (manifest: ScenarioManifest) => [
        ...manifest.briefs.assignments.slice(0, 3),
        {
          ...manifest.briefs.assignments[3],
          id: manifest.briefs.assignments[0]?.id,
        },
      ],
    },
  ])("rejects $name", async ({ assignments }) => {
    const fixture = await readyFixture();
    await fixture.writeManifest({
      ...fixture.manifest,
      briefs: { ...fixture.manifest.briefs, assignments: assignments(fixture.manifest) },
    });

    await expect(loadScenarioManifest(fixture.manifestPath)).rejects.toMatchObject({
      code: "INVALID_SCENARIO_MANIFEST",
      field: "/briefs/assignments",
    });
  });

  it("rejects a mutable image tag", async () => {
    const fixture = await readyFixture();
    await fixture.writeManifest({
      ...fixture.manifest,
      images: { ...fixture.manifest.images, participant: "node:24" },
    });

    await expect(loadScenarioManifest(fixture.manifestPath)).rejects.toMatchObject({
      code: "INVALID_SCENARIO_MANIFEST",
      field: "/images/participant",
    });
  });

  it("rejects an abbreviated repository revision", async () => {
    const fixture = await readyFixture();
    await fixture.writeManifest({
      ...fixture.manifest,
      repository: {
        ...fixture.manifest.repository,
        baseRevision: fixture.manifest.repository.baseRevision.slice(0, 8),
      },
    });

    await expect(loadScenarioManifest(fixture.manifestPath)).rejects.toMatchObject({
      code: "INVALID_SCENARIO_MANIFEST",
      field: "/repository/baseRevision",
    });
  });

  it("rejects a full repository revision that does not exist", async () => {
    const fixture = await readyFixture();
    await fixture.writeManifest({
      ...fixture.manifest,
      repository: {
        ...fixture.manifest.repository,
        baseRevision: "0".repeat(40),
      },
    });

    await expect(loadScenarioManifest(fixture.manifestPath)).rejects.toMatchObject({
      code: "REPOSITORY_REVISION_NOT_FOUND",
      field: "/repository/baseRevision",
    });
  });

  it.each([
    ["rounds", 4],
    ["roundDurationSeconds", 3_601],
    ["trustedTestWallTimeSeconds", 3_601],
    ["cpuCores", 2.1],
    ["memoryMiB", 4_097],
    ["processLimit", 257],
    ["workspaceMiB", 10_241],
    ["temporaryStorageMiB", 513],
    ["maximumFileMiB", 10_241],
  ] as const)("rejects an unsafe %s limit", async (name, value) => {
    const fixture = await readyFixture();
    await fixture.writeManifest({
      ...fixture.manifest,
      limits: { ...fixture.manifest.limits, [name]: value },
    });

    await expect(loadScenarioManifest(fixture.manifestPath)).rejects.toMatchObject({
      code: "INVALID_SCENARIO_MANIFEST",
      field: `/limits/${name}`,
    });
  });

  it("rejects a file-size limit larger than its workspace", async () => {
    const fixture = await readyFixture();
    await fixture.writeManifest({
      ...fixture.manifest,
      limits: {
        ...fixture.manifest.limits,
        workspaceMiB: 64,
        maximumFileMiB: 65,
      },
    });

    await expect(loadScenarioManifest(fixture.manifestPath)).rejects.toMatchObject({
      code: "INVALID_SCENARIO_MANIFEST",
      field: "/limits/maximumFileMiB",
    });
  });

  it("reports an oversized manifest before parsing it", async () => {
    const fixture = await createScenarioFixture();
    await writeFile(fixture.manifestPath, " ".repeat(256 * 1024 + 1));

    await expect(loadScenarioManifest(fixture.manifestPath)).rejects.toMatchObject({
      code: "SCENARIO_MANIFEST_TOO_LARGE",
    });
  });

  it("uses the public error type for manifest failures", async () => {
    const fixture = await readyFixture();
    await fixture.writeManifest({ ...fixture.manifest, title: "" });

    await expect(loadScenarioManifest(fixture.manifestPath)).rejects.toBeInstanceOf(
      ScenarioManifestError,
    );
  });
});
