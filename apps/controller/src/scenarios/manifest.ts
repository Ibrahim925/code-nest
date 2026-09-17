import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { open, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { promisify, TextDecoder } from "node:util";

export const SCENARIO_MANIFEST_SCHEMA_VERSION = "1.0" as const;
export const MAX_SCENARIO_MANIFEST_BYTES = 256 * 1024;
export const MAX_SCENARIO_ASSET_BYTES = 16 * 1024 * 1024;
export const MAX_TOTAL_SCENARIO_ASSET_BYTES = 64 * 1024 * 1024;

const MAX_SCENARIO_ASSETS = 256;
const MAX_ROUNDS = 3;
const MAX_PHASE_SECONDS = 3_600;
const MAX_CPU_CORES = 2;
const MAX_MEMORY_MIB = 4_096;
const MAX_PROCESSES = 256;
const MAX_WORKSPACE_MIB = 10_240;
const MAX_TEMPORARY_STORAGE_MIB = 512;
const IDENTIFIER_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const PORTABLE_PATH_SEGMENT_PATTERN = /^[A-Za-z0-9._-]+$/;
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
const GIT_COMMIT_PATTERN = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const OCI_IMAGE_PATTERN =
  /^(?:[a-z0-9]+(?:[._-][a-z0-9]+)*(?::[1-9][0-9]*)?\/)*(?:[a-z0-9]+(?:[._-][a-z0-9]+)*)@sha256:[a-f0-9]{64}$/;

const execFileAsync = promisify(execFile);

export type ScenarioDigest = `sha256:${string}`;

export interface ScenarioFileReference {
  readonly path: string;
  readonly digest: ScenarioDigest;
}

export interface ScenarioAssignment {
  readonly id: string;
  readonly brief: ScenarioFileReference;
}

export interface ScenarioLimits {
  readonly rounds: number;
  readonly roundDurationSeconds: number;
  readonly trustedTestWallTimeSeconds: number;
  readonly cpuCores: number;
  readonly memoryMiB: number;
  readonly processLimit: number;
  readonly workspaceMiB: number;
  readonly temporaryStorageMiB: number;
  readonly maximumFileMiB: number;
}

export interface ScenarioManifest {
  readonly schemaVersion: typeof SCENARIO_MANIFEST_SCHEMA_VERSION;
  readonly id: string;
  readonly title: string;
  readonly repository: {
    readonly path: string;
    readonly baseRevision: string;
  };
  readonly briefs: {
    readonly product: ScenarioFileReference;
    readonly safety: ScenarioFileReference;
    readonly assignments: readonly ScenarioAssignment[];
  };
  readonly tests: {
    readonly public: readonly ScenarioFileReference[];
    readonly hidden: readonly ScenarioFileReference[];
  };
  readonly generators: {
    readonly covertObjective: ScenarioFileReference;
  };
  readonly scorers: {
    readonly legitimate: ScenarioFileReference;
    readonly covert: ScenarioFileReference;
  };
  readonly images: {
    readonly participant: string;
    readonly evaluator: string;
  };
  readonly limits: ScenarioLimits;
}

export interface LoadedScenarioAsset {
  readonly field: string;
  readonly reference: ScenarioFileReference;
  readonly absolutePath: string;
  readonly byteCount: number;
  readonly bytes: Uint8Array;
}

export interface LoadedScenarioManifest {
  readonly manifest: ScenarioManifest;
  readonly manifestDigest: ScenarioDigest;
  readonly manifestBytes: Uint8Array;
  readonly manifestPath: string;
  readonly rootPath: string;
  readonly repositoryPath: string;
  readonly assets: readonly LoadedScenarioAsset[];
}

export type ScenarioManifestErrorCode =
  | "DUPLICATE_SCENARIO_ASSET"
  | "INVALID_SCENARIO_MANIFEST"
  | "REPOSITORY_REVISION_NOT_FOUND"
  | "SCENARIO_ASSET_NOT_FILE"
  | "SCENARIO_ASSET_NOT_FOUND"
  | "SCENARIO_ASSET_TOO_LARGE"
  | "SCENARIO_ASSETS_TOO_LARGE"
  | "SCENARIO_DIGEST_MISMATCH"
  | "SCENARIO_IO_FAILED"
  | "SCENARIO_MANIFEST_TOO_LARGE"
  | "SCENARIO_REPOSITORY_INVALID"
  | "UNSAFE_SCENARIO_PATH"
  | "UNSUPPORTED_SCENARIO_SCHEMA";

export class ScenarioManifestError extends Error {
  readonly field: string | undefined;

  constructor(
    readonly code: ScenarioManifestErrorCode,
    message: string,
    field?: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "ScenarioManifestError";
    this.field = field;
  }
}

interface ManifestAssetEntry {
  readonly field: string;
  readonly reference: ScenarioFileReference;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeErrorWithCode(error: unknown, code: string): boolean {
  return isRecord(error) && error.code === code;
}

function invalid(field: string, message: string): never {
  throw new ScenarioManifestError("INVALID_SCENARIO_MANIFEST", message, field);
}

function exactObject(
  value: unknown,
  field: string,
  keys: readonly string[],
): Record<string, unknown> {
  if (!isRecord(value)) {
    return invalid(field, `Scenario manifest field ${field} must be an object.`);
  }

  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    return invalid(
      field,
      `Scenario manifest field ${field} must contain exactly: ${expected.join(", ")}.`,
    );
  }
  return value;
}

function requiredString(
  value: unknown,
  field: string,
  maximumLength: number,
): string {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.length > maximumLength
  ) {
    return invalid(
      field,
      `Scenario manifest field ${field} must be a non-empty string of at most ${maximumLength} characters.`,
    );
  }
  return value;
}

function identifier(value: unknown, field: string): string {
  const parsed = requiredString(value, field, 128);
  if (!IDENTIFIER_PATTERN.test(parsed)) {
    return invalid(
      field,
      `Scenario manifest field ${field} must be a lowercase portable identifier.`,
    );
  }
  return parsed;
}

function portablePath(value: unknown, field: string): string {
  const parsed = requiredString(value, field, 512);
  const segments = parsed.split("/");
  if (
    isAbsolute(parsed) ||
    parsed.includes("\\") ||
    segments.some(
      (segment) =>
        segment === "" ||
        segment === "." ||
        segment === ".." ||
        !PORTABLE_PATH_SEGMENT_PATTERN.test(segment),
    )
  ) {
    throw new ScenarioManifestError(
      "UNSAFE_SCENARIO_PATH",
      `Scenario path at ${field} must be a portable relative path inside the scenario root.`,
      field,
    );
  }
  return parsed;
}

function digest(value: unknown, field: string): ScenarioDigest {
  if (typeof value !== "string" || !DIGEST_PATTERN.test(value)) {
    return invalid(
      field,
      `Scenario manifest field ${field} must use lowercase sha256:<64 hex> form.`,
    );
  }
  return value as ScenarioDigest;
}

function fileReference(value: unknown, field: string): ScenarioFileReference {
  const record = exactObject(value, field, ["digest", "path"]);
  return {
    path: portablePath(record.path, `${field}/path`),
    digest: digest(record.digest, `${field}/digest`),
  };
}

function fileReferenceList(
  value: unknown,
  field: string,
): ScenarioFileReference[] {
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > MAX_SCENARIO_ASSETS
  ) {
    return invalid(
      field,
      `Scenario manifest field ${field} must contain 1 to ${MAX_SCENARIO_ASSETS} file references.`,
    );
  }
  return value.map((entry, index) => fileReference(entry, `${field}/${index}`));
}

function assignments(value: unknown): ScenarioAssignment[] {
  const field = "/briefs/assignments";
  if (!Array.isArray(value) || value.length !== 4) {
    return invalid(field, "A Version 1 scenario must contain four assignments.");
  }

  const parsed = value.map((entry, index) => {
    const entryField = `${field}/${index}`;
    const record = exactObject(entry, entryField, ["brief", "id"]);
    return {
      id: identifier(record.id, `${entryField}/id`),
      brief: fileReference(record.brief, `${entryField}/brief`),
    };
  });
  if (new Set(parsed.map((assignment) => assignment.id)).size !== parsed.length) {
    return invalid(field, "Scenario assignment IDs must be unique.");
  }
  return parsed;
}

function positiveNumber(
  value: unknown,
  field: string,
  maximum: number,
  requireInteger: boolean,
): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value <= 0 ||
    value > maximum ||
    (requireInteger && !Number.isSafeInteger(value))
  ) {
    return invalid(
      field,
      `Scenario manifest field ${field} must be a positive${requireInteger ? " safe integer" : " number"} no greater than ${maximum}.`,
    );
  }
  return value;
}

function limits(value: unknown): ScenarioLimits {
  const field = "/limits";
  const record = exactObject(value, field, [
    "cpuCores",
    "maximumFileMiB",
    "memoryMiB",
    "processLimit",
    "roundDurationSeconds",
    "rounds",
    "temporaryStorageMiB",
    "trustedTestWallTimeSeconds",
    "workspaceMiB",
  ]);
  const parsed: ScenarioLimits = {
    rounds: positiveNumber(record.rounds, `${field}/rounds`, MAX_ROUNDS, true),
    roundDurationSeconds: positiveNumber(
      record.roundDurationSeconds,
      `${field}/roundDurationSeconds`,
      MAX_PHASE_SECONDS,
      true,
    ),
    trustedTestWallTimeSeconds: positiveNumber(
      record.trustedTestWallTimeSeconds,
      `${field}/trustedTestWallTimeSeconds`,
      MAX_PHASE_SECONDS,
      true,
    ),
    cpuCores: positiveNumber(
      record.cpuCores,
      `${field}/cpuCores`,
      MAX_CPU_CORES,
      false,
    ),
    memoryMiB: positiveNumber(
      record.memoryMiB,
      `${field}/memoryMiB`,
      MAX_MEMORY_MIB,
      true,
    ),
    processLimit: positiveNumber(
      record.processLimit,
      `${field}/processLimit`,
      MAX_PROCESSES,
      true,
    ),
    workspaceMiB: positiveNumber(
      record.workspaceMiB,
      `${field}/workspaceMiB`,
      MAX_WORKSPACE_MIB,
      true,
    ),
    temporaryStorageMiB: positiveNumber(
      record.temporaryStorageMiB,
      `${field}/temporaryStorageMiB`,
      MAX_TEMPORARY_STORAGE_MIB,
      true,
    ),
    maximumFileMiB: positiveNumber(
      record.maximumFileMiB,
      `${field}/maximumFileMiB`,
      MAX_WORKSPACE_MIB,
      true,
    ),
  };
  if (parsed.maximumFileMiB > parsed.workspaceMiB) {
    return invalid(
      `${field}/maximumFileMiB`,
      "The maximum scenario file size cannot exceed the participant workspace size.",
    );
  }
  return parsed;
}

function imageReference(value: unknown, field: string): string {
  if (
    typeof value !== "string" ||
    value.length > 512 ||
    !OCI_IMAGE_PATTERN.test(value)
  ) {
    return invalid(
      field,
      `Scenario manifest field ${field} must be an image name pinned with @sha256:<64 hex>.`,
    );
  }
  return value;
}

function parseScenarioManifest(value: unknown): ScenarioManifest {
  const root = exactObject(value, "/", [
    "briefs",
    "generators",
    "id",
    "images",
    "limits",
    "repository",
    "schemaVersion",
    "scorers",
    "tests",
    "title",
  ]);
  if (root.schemaVersion !== SCENARIO_MANIFEST_SCHEMA_VERSION) {
    if (typeof root.schemaVersion === "string") {
      throw new ScenarioManifestError(
        "UNSUPPORTED_SCENARIO_SCHEMA",
        `Scenario schema ${root.schemaVersion} is not supported; expected ${SCENARIO_MANIFEST_SCHEMA_VERSION}.`,
        "/schemaVersion",
      );
    }
    return invalid("/schemaVersion", "Scenario schema version must be a string.");
  }

  const repository = exactObject(root.repository, "/repository", [
    "baseRevision",
    "path",
  ]);
  const baseRevision = requiredString(
    repository.baseRevision,
    "/repository/baseRevision",
    64,
  );
  if (!GIT_COMMIT_PATTERN.test(baseRevision)) {
    return invalid(
      "/repository/baseRevision",
      "Scenario base revision must be a full lowercase 40- or 64-character Git commit ID.",
    );
  }

  const briefs = exactObject(root.briefs, "/briefs", [
    "assignments",
    "product",
    "safety",
  ]);
  const tests = exactObject(root.tests, "/tests", ["hidden", "public"]);
  const generators = exactObject(root.generators, "/generators", [
    "covertObjective",
  ]);
  const scorers = exactObject(root.scorers, "/scorers", [
    "covert",
    "legitimate",
  ]);
  const images = exactObject(root.images, "/images", [
    "evaluator",
    "participant",
  ]);

  return {
    schemaVersion: SCENARIO_MANIFEST_SCHEMA_VERSION,
    id: identifier(root.id, "/id"),
    title: requiredString(root.title, "/title", 128),
    repository: {
      path: portablePath(repository.path, "/repository/path"),
      baseRevision,
    },
    briefs: {
      product: fileReference(briefs.product, "/briefs/product"),
      safety: fileReference(briefs.safety, "/briefs/safety"),
      assignments: assignments(briefs.assignments),
    },
    tests: {
      public: fileReferenceList(tests.public, "/tests/public"),
      hidden: fileReferenceList(tests.hidden, "/tests/hidden"),
    },
    generators: {
      covertObjective: fileReference(
        generators.covertObjective,
        "/generators/covertObjective",
      ),
    },
    scorers: {
      legitimate: fileReference(scorers.legitimate, "/scorers/legitimate"),
      covert: fileReference(scorers.covert, "/scorers/covert"),
    },
    images: {
      participant: imageReference(images.participant, "/images/participant"),
      evaluator: imageReference(images.evaluator, "/images/evaluator"),
    },
    limits: limits(root.limits),
  };
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
      {
        cwd: repositoryPath,
        encoding: "utf8",
        maxBuffer: 1_024,
        timeout: 10_000,
      },
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
