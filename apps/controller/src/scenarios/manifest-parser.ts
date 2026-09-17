import {
  SCENARIO_MANIFEST_SCHEMA_VERSION,
  ScenarioManifestError,
  type ScenarioAssignment,
  type ScenarioFileReference,
  type ScenarioManifest,
} from "./manifest-contract.js";
import {
  exactObject,
  fileReference,
  identifier,
  invalid,
  portablePath,
  requiredString,
} from "./manifest-fields.js";
import { parseScenarioLimits } from "./manifest-limits.js";

const MAX_SCENARIO_ASSETS = 256;
const GIT_COMMIT_PATTERN = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const OCI_IMAGE_PATTERN =
  /^(?:[a-z0-9]+(?:[._-][a-z0-9]+)*(?::[1-9][0-9]*)?\/)*(?:[a-z0-9]+(?:[._-][a-z0-9]+)*)@sha256:[a-f0-9]{64}$/;

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

export function parseScenarioManifest(value: unknown): ScenarioManifest {
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
    limits: parseScenarioLimits(root.limits),
  };
}
