import {
  mkdir,
  readFile,
  realpath,
  rm,
  symlink,
  truncate,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadScenarioManifest } from "./manifest.js";
import {
  MAX_ASSET_BYTES,
  cleanupScenarioFixtures,
  createScenarioFixture,
  createTemporaryDirectory,
  readyFixture,
  sha256,
} from "./manifest.test-fixture.js";

afterEach(cleanupScenarioFixtures);

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
    expect(loaded.assets.map((asset) => asset.field).sort()).toEqual([
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
    await fixture.writeManifest({ ...fixture.manifest, schemaVersion: "2.0" });
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
        product: { ...fixture.manifest.briefs.product, path },
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
});
