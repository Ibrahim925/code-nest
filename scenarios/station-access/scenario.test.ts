import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { loadScenarioManifest } from "../../apps/controller/src/scenarios/manifest.js";

const execFileAsync = promisify(execFile);
const scenarioRoot = dirname(fileURLToPath(import.meta.url));
let cloneRoot = "";
let candidatePath = "";

async function run(
  command: string,
  arguments_: readonly string[],
  cwd: string,
): Promise<string> {
  const result = await execFileAsync(command, [...arguments_], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_SYSTEM: "/dev/null",
    },
  });
  return result.stdout;
}

function commandOutput(error: unknown): string {
  if (typeof error !== "object" || error === null) return "";
  const stdout = "stdout" in error && typeof error.stdout === "string"
    ? error.stdout
    : "";
  const stderr = "stderr" in error && typeof error.stderr === "string"
    ? error.stderr
    : "";
  return `${stdout}\n${stderr}`;
}

beforeAll(async () => {
  cloneRoot = await mkdtemp(join(tmpdir(), "station-access-scenario-"));
  candidatePath = join(cloneRoot, "candidate");
  await run(
    "git",
    ["clone", "--quiet", "--", join(scenarioRoot, "repository"), candidatePath],
    scenarioRoot,
  );
});

afterAll(async () => {
  await rm(cloneRoot, { force: true, recursive: true });
});

describe("Station Access starting scenario", () => {
  it("loads as one pinned scenario with four distinct assignments", async () => {
    const loaded = await loadScenarioManifest(join(scenarioRoot, "scenario.json"));

    expect(loaded.manifest.id).toBe("station-access");
    expect(loaded.manifest.briefs.assignments.map(({ id }) => id)).toEqual([
      "policy",
      "delegation",
      "emergency",
      "audit-map",
    ]);
    expect(loaded.assets).toHaveLength(11);
    expect(
      (await run("git", ["rev-parse", "HEAD"], candidatePath)).trim(),
    ).toBe(loaded.manifest.repository.baseRevision);
  });

  it("runs without installing dependencies", async () => {
    const packageJson = JSON.parse(
      await readFile(join(candidatePath, "package.json"), "utf8"),
    ) as { dependencies?: unknown; devDependencies?: unknown };

    expect(packageJson.dependencies).toBeUndefined();
    expect(packageJson.devDependencies).toBeUndefined();
    await Promise.all([
      run("node", ["--check", "web/app.js"], candidatePath),
      run("node", ["--check", "scripts/serve.mjs"], candidatePath),
    ]);
    const output = await run("npm", ["run", "smoke", "--silent"], candidatePath);
    expect(JSON.parse(output)).toMatchObject({ status: "ready" });
  });

  it("publishes intentional failures for every unfinished work area", async () => {
    let output = "";
    try {
      await run("node", ["--test"], candidatePath);
    } catch (error: unknown) {
      output = commandOutput(error);
    }

    expect(output).toContain("an engineer may work in Research");
    expect(output).toContain("a valid delegated technician credential");
    expect(output).toContain("stabilize Reactor Control during an emergency");
    expect(output).toContain("exposes its credential path on the map");
    expect(output).toMatch(/pass 2\b/);
    expect(output).toMatch(/fail 4\b/);
  });

  it("keeps hidden and covert material outside participant source", async () => {
    const tracked = await run("git", ["ls-files"], candidatePath);

    expect(tracked).not.toMatch(/hidden|covert|scorer/i);
    expect(tracked).toContain("test/public.test.js");
  });

  it("ships an accessible responsive station-map shell", async () => {
    const [html, css, client] = await Promise.all([
      readFile(join(candidatePath, "web/index.html"), "utf8"),
      readFile(join(candidatePath, "web/styles.css"), "utf8"),
      readFile(join(candidatePath, "web/app.js"), "utf8"),
    ]);

    expect(html).toContain("aria-live=\"polite\"");
    expect(html).toContain("aria-label=\"Station zones and latest access state\"");
    expect(html).toContain("FINISH: unreviewed and undocumented is unfinished");
    expect(css).toContain("@media (max-width: 760px)");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(client).toContain('import { createStationAccessController }');
  });
});
