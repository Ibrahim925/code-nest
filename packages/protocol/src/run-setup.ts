import Type from "typebox";
import Schema from "typebox/schema";

import type { ParseResult } from "./envelope-parser.js";
import {
  normalizeIssues,
  type RawValidationIssue,
  type ValidationIssue,
} from "./envelope-validation.js";

export const RUN_SETUP_SCHEMA_VERSION = "1.0" as const;

const IdentifierSchema = Type.String({
  minLength: 1,
  maxLength: 128,
  pattern: "^[a-z0-9][a-z0-9._-]{0,127}$",
});
const DigestSchema = Type.String({ pattern: "^sha256:[a-f0-9]{64}$" });
const RevisionSchema = Type.String({ pattern: "^(?:[a-f0-9]{40}|[a-f0-9]{64})$" });
const ImageSchema = Type.String({
  minLength: 75,
  maxLength: 512,
  pattern: "^[a-z0-9./_-]+@sha256:[a-f0-9]{64}$",
});

const AdapterSelectionSchema = Type.Object(
  {
    participantId: IdentifierSchema,
    adapterId: IdentifierSchema,
    executionMode: Type.Union([Type.Literal("contained"), Type.Literal("split")]),
    modelDisclosure: Type.String({ minLength: 1, maxLength: 256 }),
  },
  { additionalProperties: false },
);

const RunLimitsSchema = Type.Object(
  {
    rounds: Type.Integer({ minimum: 1, maximum: 3 }),
    roundDurationSeconds: Type.Integer({ minimum: 1, maximum: 3_600 }),
    trustedTestWallTimeSeconds: Type.Integer({ minimum: 1, maximum: 3_600 }),
    cpuCores: Type.Integer({ minimum: 1, maximum: 2 }),
    memoryMiB: Type.Integer({ minimum: 128, maximum: 4_096 }),
    processLimit: Type.Integer({ minimum: 1, maximum: 256 }),
    workspaceMiB: Type.Integer({ minimum: 1, maximum: 10_240 }),
    temporaryStorageMiB: Type.Integer({ minimum: 1, maximum: 512 }),
  },
  { additionalProperties: false },
);

export const RunSetupConfigurationSchema = Type.Object(
  {
    schemaVersion: Type.Literal(RUN_SETUP_SCHEMA_VERSION),
    runId: IdentifierSchema,
    scenario: Type.Object(
      {
        id: IdentifierSchema,
        manifestDigest: DigestSchema,
        repositoryRevision: RevisionSchema,
        participantImage: ImageSchema,
        evaluatorImage: ImageSchema,
      },
      { additionalProperties: false },
    ),
    adapters: Type.Array(AdapterSelectionSchema, { minItems: 4, maxItems: 4 }),
    seed: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
    limits: RunLimitsSchema,
    disclosurePolicy: Type.Union([
      Type.Literal("clean-until-reveal"),
      Type.Literal("researcher-unblinded"),
    ]),
    constitution: Type.Union([
      Type.Literal("open-merge"),
      Type.Literal("council"),
      Type.Literal("elected-maintainer"),
    ]),
  },
  {
    $id: "urn:code-nest:protocol:v1:run-setup",
    additionalProperties: false,
  },
);

export type RunSetupConfiguration = Type.Static<typeof RunSetupConfigurationSchema>;

export interface RunSetupError {
  readonly code: "INVALID_RUN_SETUP";
  readonly message: string;
  readonly issues: readonly ValidationIssue[];
}

const validator = Schema.Compile(RunSetupConfigurationSchema);

function duplicateParticipantIssues(input: RunSetupConfiguration): ValidationIssue[] {
  const seen = new Set<string>();
  const issues: ValidationIssue[] = [];
  input.adapters.forEach((adapter, index) => {
    if (seen.has(adapter.participantId)) {
      issues.push({
        code: "unique_participant",
        message: "Participant identities must be unique.",
        path: `/adapters/${index}/participantId`,
      });
    }
    seen.add(adapter.participantId);
  });
  return issues;
}

export function parseRunSetupConfiguration(
  input: unknown,
): ParseResult<RunSetupConfiguration, RunSetupError> {
  if (validator.Check(input)) {
    const issues = duplicateParticipantIssues(input);
    return issues.length === 0
      ? { ok: true, value: input }
      : {
          ok: false,
          error: {
            code: "INVALID_RUN_SETUP",
            message: "Run setup failed validation.",
            issues,
          },
        };
  }
  const [, errors] = validator.Errors(input);
  return {
    ok: false,
    error: {
      code: "INVALID_RUN_SETUP",
      message: "Run setup failed validation.",
      issues: normalizeIssues(errors as RawValidationIssue[]),
    },
  };
}
