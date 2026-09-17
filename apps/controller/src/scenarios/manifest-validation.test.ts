import { writeFile } from "node:fs/promises";

import { afterEach, describe, expect, it } from "vitest";

import {
  loadScenarioManifest,
  ScenarioManifestError,
  type ScenarioManifest,
} from "./manifest.js";
import {
  cleanupScenarioFixtures,
  createScenarioFixture,
  readyFixture,
} from "./manifest.test-fixture.js";

afterEach(cleanupScenarioFixtures);

describe("scenario manifest validation", () => {
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
      briefs: {
        ...fixture.manifest.briefs,
        assignments: assignments(fixture.manifest),
      },
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
