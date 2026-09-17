import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { open, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { promisify, TextDecoder } from "node:util";

import {
  MAX_SCENARIO_ASSET_BYTES,
  MAX_SCENARIO_MANIFEST_BYTES,
  MAX_TOTAL_SCENARIO_ASSET_BYTES,
  ScenarioManifestError,
  type LoadedScenarioAsset,
  type LoadedScenarioManifest,
  type ScenarioDigest,
  type ScenarioFileReference,
  type ScenarioManifest,
  type ScenarioManifestErrorCode,
} from "./manifest-contract.js";
import { invalid, isRecord } from "./manifest-fields.js";
import { parseScenarioManifest } from "./manifest-parser.js";

const MAX_SCENARIO_ASSETS = 256;
const execFileAsync = promisify(execFile);

interface ManifestAssetEntry {
  readonly field: string;
  readonly reference: ScenarioFileReference;
}

function isNodeErrorWithCode(error: unknown, code: string): boolean {
  return isRecord(error) && error.code === code;
}

function manifestAssetEntries(manifest: ScenarioManifest): ManifestAssetEntry[] {
  return [
    { field: "/briefs/product", reference: manifest.briefs.product },
    { field: "/briefs/safety", reference: manifest.briefs.safety },
    ...manifest.briefs.assignments.map((assignment, index) => ({
      field: `/briefs/assignments/${index}/brief`,
      reference: assignment.brief,
    })),
    ...manifest.tests.public.map((reference, index) => ({
      field: `/tests/public/${index}`,
      reference,
    })),
    ...manifest.tests.hidden.map((reference, index) => ({
      field: `/tests/hidden/${index}`,
      reference,
    })),
    {
      field: "/generators/covertObjective",
      reference: manifest.generators.covertObjective,
    },
    { field: "/scorers/legitimate", reference: manifest.scorers.legitimate },
    { field: "/scorers/covert", reference: manifest.scorers.covert },
  ];
}

function sha256(bytes: Uint8Array): ScenarioDigest {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function isInsideRoot(rootPath: string, targetPath: string): boolean {
  const difference = relative(rootPath, targetPath);
  return (
    difference !== "" &&
    difference !== ".." &&
    !difference.startsWith(`..${sep}`) &&
    !isAbsolute(difference)
  );
}

async function canonicalScenarioPath(
  rootPath: string,
  declaredPath: string,
  field: string,
  missingCode: ScenarioManifestErrorCode,
  unsafeField = field,
): Promise<string> {
  let canonicalPath: string;
  try {
    canonicalPath = await realpath(join(rootPath, declaredPath));
  } catch (error) {
    if (isNodeErrorWithCode(error, "ENOENT")) {
      throw new ScenarioManifestError(
        missingCode,
        `Scenario entry at ${field} does not exist.`,
        field,
        error,
      );
    }
    throw new ScenarioManifestError(
      "SCENARIO_IO_FAILED",
      `Scenario entry at ${field} could not be resolved.`,
      field,
      error,
    );
  }
  if (!isInsideRoot(rootPath, canonicalPath)) {
    throw new ScenarioManifestError(
      "UNSAFE_SCENARIO_PATH",
      `Scenario path at ${unsafeField} resolves outside the scenario root.`,
      unsafeField,
    );
  }
  return canonicalPath;
}

async function readBoundedFile(
  absolutePath: string,
  maximumBytes: number,
  field: string,
  notFileCode: ScenarioManifestErrorCode,
  tooLargeCode: ScenarioManifestErrorCode,
): Promise<Uint8Array> {
  let handle;
  try {
    handle = await open(absolutePath, "r");
    const information = await handle.stat();
    if (!information.isFile()) {
      throw new ScenarioManifestError(
        notFileCode,
        `Scenario entry at ${field} must be a regular file.`,
        field,
      );
    }
    if (information.size > maximumBytes) {
      throw new ScenarioManifestError(
        tooLargeCode,
        `Scenario entry at ${field} exceeds the ${maximumBytes}-byte limit.`,
        field,
      );
    }
    const bytes = await handle.readFile();
    if (bytes.byteLength > maximumBytes) {
      throw new ScenarioManifestError(
        tooLargeCode,
        `Scenario entry at ${field} exceeds the ${maximumBytes}-byte limit.`,
        field,
      );
    }
    return new Uint8Array(bytes);
  } catch (error) {
    if (error instanceof ScenarioManifestError) throw error;
    throw new ScenarioManifestError(
      "SCENARIO_IO_FAILED",
      `Scenario entry at ${field} could not be read.`,
      field,
      error,
    );
  } finally {
    await handle?.close();
  }
}

function decodeManifest(bytes: Uint8Array): unknown {
  try {
    const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return JSON.parse(source) as unknown;
  } catch (error) {
    throw new ScenarioManifestError(
      "INVALID_SCENARIO_MANIFEST",
      "Scenario manifest must contain valid UTF-8 JSON.",
      "/",
      error,
    );
  }
}

async function verifyRepository(
  rootPath: string,
  manifest: ScenarioManifest,
): Promise<string> {
  const field = "/repository/path";
  const repositoryPath = await canonicalScenarioPath(
    rootPath,
    manifest.repository.path,
    field,
    "SCENARIO_REPOSITORY_INVALID",
  );
  let information;
  try {
    information = await stat(repositoryPath);
  } catch (error) {
    throw new ScenarioManifestError(
      "SCENARIO_IO_FAILED",
      "Scenario repository could not be inspected.",
      field,
      error,
    );
  }
  if (!information.isDirectory()) {
    throw new ScenarioManifestError(
      "SCENARIO_REPOSITORY_INVALID",
      "Scenario repository must be a directory.",
      field,
    );
  }
  try {
    await execFileAsync(
      "git",
      ["cat-file", "-e", `${manifest.repository.baseRevision}^{commit}`],
      { cwd: repositoryPath, encoding: "utf8", maxBuffer: 1_024, timeout: 10_000 },
    );
  } catch (error) {
    if (isNodeErrorWithCode(error, "ENOENT")) {
      throw new ScenarioManifestError(
        "SCENARIO_IO_FAILED",
        "Git is required to verify the scenario repository.",
        "/repository/baseRevision",
        error,
      );
    }
    throw new ScenarioManifestError(
      "REPOSITORY_REVISION_NOT_FOUND",
      "The pinned scenario repository revision does not exist as a commit.",
      "/repository/baseRevision",
      error,
    );
  }
  return repositoryPath;
}

async function loadAssets(
  rootPath: string,
  manifest: ScenarioManifest,
): Promise<LoadedScenarioAsset[]> {
  const entries = manifestAssetEntries(manifest);
  if (entries.length > MAX_SCENARIO_ASSETS) {
    return invalid(
      "/",
      `A scenario manifest may reference at most ${MAX_SCENARIO_ASSETS} assets.`,
    );
  }
  const declaredPaths = new Map<string, string>();
  const canonicalPaths = new Map<string, string>();
  const loaded: LoadedScenarioAsset[] = [];
  let totalByteCount = 0;
  for (const entry of entries) {
    if (declaredPaths.has(entry.reference.path)) {
      throw new ScenarioManifestError(
        "DUPLICATE_SCENARIO_ASSET",
        "Each manifest field must reference a distinct scenario file.",
        entry.field,
      );
    }
    declaredPaths.set(entry.reference.path, entry.field);
    const absolutePath = await canonicalScenarioPath(
      rootPath,
      entry.reference.path,
      entry.field,
      "SCENARIO_ASSET_NOT_FOUND",
      `${entry.field}/path`,
    );
    if (canonicalPaths.has(absolutePath)) {
      throw new ScenarioManifestError(
        "DUPLICATE_SCENARIO_ASSET",
        "Each manifest field must resolve to a distinct scenario file.",
        entry.field,
      );
    }
    canonicalPaths.set(absolutePath, entry.field);
    const bytes = await readBoundedFile(
      absolutePath,
      MAX_SCENARIO_ASSET_BYTES,
      entry.field,
      "SCENARIO_ASSET_NOT_FILE",
      "SCENARIO_ASSET_TOO_LARGE",
    );
    totalByteCount += bytes.byteLength;
    if (totalByteCount > MAX_TOTAL_SCENARIO_ASSET_BYTES) {
      throw new ScenarioManifestError(
        "SCENARIO_ASSETS_TOO_LARGE",
        `Scenario assets exceed the ${MAX_TOTAL_SCENARIO_ASSET_BYTES}-byte aggregate limit.`,
        entry.field,
      );
    }
    if (sha256(bytes) !== entry.reference.digest) {
      throw new ScenarioManifestError(
        "SCENARIO_DIGEST_MISMATCH",
        `Scenario asset at ${entry.field} does not match its declared SHA-256 digest.`,
        entry.field,
      );
    }
    loaded.push({
      field: entry.field,
      reference: entry.reference,
      absolutePath,
      byteCount: bytes.byteLength,
      bytes,
    });
  }
  return loaded;
}

export async function loadScenarioManifest(
  inputPath: string,
): Promise<LoadedScenarioManifest> {
  if (typeof inputPath !== "string" || inputPath.trim().length === 0) {
    return invalid("/", "Scenario manifest path must be a non-empty string.");
  }
  let manifestPath: string;
  try {
    manifestPath = await realpath(resolve(inputPath));
  } catch (error) {
    throw new ScenarioManifestError(
      "SCENARIO_IO_FAILED",
      "Scenario manifest could not be resolved.",
      undefined,
      error,
    );
  }
  const manifestBytes = await readBoundedFile(
    manifestPath,
    MAX_SCENARIO_MANIFEST_BYTES,
    "/",
    "INVALID_SCENARIO_MANIFEST",
    "SCENARIO_MANIFEST_TOO_LARGE",
  );
  const manifest = parseScenarioManifest(decodeManifest(manifestBytes));
  const rootPath = dirname(manifestPath);
  const repositoryPath = await verifyRepository(rootPath, manifest);
  const assets = await loadAssets(rootPath, manifest);
  return {
    manifest,
    manifestDigest: sha256(manifestBytes),
    manifestBytes,
    manifestPath,
    rootPath,
    repositoryPath,
    assets,
  };
}
