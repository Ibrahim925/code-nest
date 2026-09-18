export const RUN_SETUP_SCHEMA_VERSION = "1.0" as const;

export type ConstitutionId = "open-merge" | "council" | "elected-maintainer";
export type DisclosurePolicy = "clean-until-reveal" | "researcher-unblinded";
export type ExecutionMode = "contained" | "split";

export interface AdapterSelection {
  readonly participantId: string;
  readonly adapterId: string;
  readonly executionMode: ExecutionMode;
  readonly modelDisclosure: string;
}

export interface RunLimits {
  readonly rounds: number;
  readonly roundDurationSeconds: number;
  readonly trustedTestWallTimeSeconds: number;
  readonly cpuCores: number;
  readonly memoryMiB: number;
  readonly processLimit: number;
  readonly workspaceMiB: number;
  readonly temporaryStorageMiB: number;
}

export interface RunSetupConfiguration {
  readonly schemaVersion: typeof RUN_SETUP_SCHEMA_VERSION;
  readonly runId: string;
  readonly scenario: {
    readonly id: string;
    readonly manifestDigest: `sha256:${string}`;
    readonly repositoryRevision: string;
    readonly participantImage: string;
    readonly evaluatorImage: string;
  };
  readonly adapters: readonly AdapterSelection[];
  readonly seed: number;
  readonly limits: RunLimits;
  readonly disclosurePolicy: DisclosurePolicy;
  readonly constitution: ConstitutionId;
}

export interface SetupCatalog {
  readonly availableAdapterIds: readonly string[];
  readonly adapterModes: Readonly<Record<string, readonly ExecutionMode[]>>;
  readonly scenarioIds: readonly string[];
}

export interface SetupIssue {
  readonly path: string;
  readonly message: string;
}

export type RunSetupValidation =
  | { readonly ok: true; readonly configuration: RunSetupConfiguration }
  | { readonly ok: false; readonly issues: readonly SetupIssue[] };

export interface RunControlView {
  readonly schemaVersion: "1.0";
  readonly runId: string;
  readonly status: "running" | "paused" | "cancelled";
  readonly terminalReason: "operator_cancelled" | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly lastEventSequence: number;
}

const IDENTIFIER = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const REVISION = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const OCI_IMAGE = /^[a-z0-9./_-]+@sha256:[a-f0-9]{64}$/;

function boundedInteger(value: number, minimum: number, maximum: number): boolean {
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

function issue(issues: SetupIssue[], path: string, message: string): void {
  issues.push({ path, message });
}

function validateLimits(limits: RunLimits, issues: SetupIssue[]): void {
  const bounds = [
    ["rounds", limits.rounds, 1, 3],
    ["roundDurationSeconds", limits.roundDurationSeconds, 1, 3_600],
    ["trustedTestWallTimeSeconds", limits.trustedTestWallTimeSeconds, 1, 3_600],
    ["cpuCores", limits.cpuCores, 1, 2],
    ["memoryMiB", limits.memoryMiB, 128, 4_096],
    ["processLimit", limits.processLimit, 1, 256],
    ["workspaceMiB", limits.workspaceMiB, 1, 10_240],
    ["temporaryStorageMiB", limits.temporaryStorageMiB, 1, 512],
  ] as const;
  for (const [field, value, minimum, maximum] of bounds) {
    if (!boundedInteger(value, minimum, maximum)) {
      issue(
        issues,
        `limits.${field}`,
        `${field} must be a whole number from ${minimum} to ${maximum}.`,
      );
    }
  }
}

export function validateRunSetup(
  value: RunSetupConfiguration,
  catalog: SetupCatalog,
): RunSetupValidation {
  const issues: SetupIssue[] = [];
  if (value.schemaVersion !== RUN_SETUP_SCHEMA_VERSION) {
    issue(issues, "schemaVersion", "The run protocol version is unsupported.");
  }
  if (!IDENTIFIER.test(value.runId)) {
    issue(issues, "runId", "Use a lowercase run ID with letters, numbers, dots, dashes, or underscores.");
  }
  if (!catalog.scenarioIds.includes(value.scenario.id)) {
    issue(issues, "scenario.id", "Choose an available scenario.");
  }
  if (!DIGEST.test(value.scenario.manifestDigest)) {
    issue(issues, "scenario.manifestDigest", "The scenario requires a full SHA-256 manifest digest.");
  }
  if (!REVISION.test(value.scenario.repositoryRevision)) {
    issue(issues, "scenario.repositoryRevision", "The source requires a full pinned Git revision.");
  }
  if (!OCI_IMAGE.test(value.scenario.participantImage)) {
    issue(issues, "scenario.participantImage", "The participant image must use an OCI SHA-256 digest.");
  }
  if (!OCI_IMAGE.test(value.scenario.evaluatorImage)) {
    issue(issues, "scenario.evaluatorImage", "The evaluator image must use an OCI SHA-256 digest.");
  }
  if (value.adapters.length !== 4) {
    issue(issues, "adapters", "Assign exactly four participant adapters.");
  }
  const participantIds = value.adapters.map(({ participantId }) => participantId);
  if (new Set(participantIds).size !== participantIds.length) {
    issue(issues, "adapters", "Each participant slot needs a unique identity.");
  }
  value.adapters.forEach((adapter, index) => {
    if (!IDENTIFIER.test(adapter.participantId)) {
      issue(issues, `adapters.${index}.participantId`, "Participant ID is invalid.");
    }
    if (!catalog.availableAdapterIds.includes(adapter.adapterId)) {
      issue(issues, `adapters.${index}.adapterId`, "This adapter is unavailable on the controller.");
    }
    if (!catalog.adapterModes[adapter.adapterId]?.includes(adapter.executionMode)) {
      issue(issues, `adapters.${index}.executionMode`, "This adapter does not support that runtime mode.");
    }
    if (adapter.modelDisclosure.trim().length === 0) {
      issue(issues, `adapters.${index}.modelDisclosure`, "Describe the model or deterministic fixture.");
    }
  });
  if (!Number.isSafeInteger(value.seed) || value.seed < 0) {
    issue(issues, "seed", "Seed must be a non-negative whole number.");
  }
  if (!(["open-merge", "council", "elected-maintainer"] as const).includes(value.constitution)) {
    issue(issues, "constitution", "Choose a supported constitution.");
  }
  if (!(["clean-until-reveal", "researcher-unblinded"] as const).includes(value.disclosurePolicy)) {
    issue(issues, "disclosurePolicy", "Choose a supported disclosure policy.");
  }
  validateLimits(value.limits, issues);
  return issues.length === 0
    ? { ok: true, configuration: structuredClone(value) }
    : { ok: false, issues };
}
