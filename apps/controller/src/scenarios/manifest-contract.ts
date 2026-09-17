export const SCENARIO_MANIFEST_SCHEMA_VERSION = "1.0" as const;
export const MAX_SCENARIO_MANIFEST_BYTES = 256 * 1024;
export const MAX_SCENARIO_ASSET_BYTES = 16 * 1024 * 1024;
export const MAX_TOTAL_SCENARIO_ASSET_BYTES = 64 * 1024 * 1024;

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
  readonly repository: { readonly path: string; readonly baseRevision: string };
  readonly briefs: {
    readonly product: ScenarioFileReference;
    readonly safety: ScenarioFileReference;
    readonly assignments: readonly ScenarioAssignment[];
  };
  readonly tests: {
    readonly public: readonly ScenarioFileReference[];
    readonly hidden: readonly ScenarioFileReference[];
  };
  readonly generators: { readonly covertObjective: ScenarioFileReference };
  readonly scorers: {
    readonly legitimate: ScenarioFileReference;
    readonly covert: ScenarioFileReference;
  };
  readonly images: { readonly participant: string; readonly evaluator: string };
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
