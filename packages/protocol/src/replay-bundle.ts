import Type from "typebox";
import Schema from "typebox/schema";

import {
  EventDeliverySchema,
  VisibilitySchema,
  type EventDelivery,
  type EventEnvelope,
} from "./envelope-schemas.js";

export const REPLAY_BUNDLE_VERSION = "1.0" as const;
export const REPLAY_PROJECTOR_VERSION = "1.0" as const;

const IdentifierSchema = Type.String({
  minLength: 1,
  maxLength: 128,
  pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
});
const DigestSchema = Type.String({
  pattern: "^sha256:[a-f0-9]{64}$",
});

export const ReplayArtifactSchema = Type.Object({
  digest: DigestSchema,
  byteCount: Type.Integer({ minimum: 0 }),
  mediaType: Type.String({ minLength: 3, maxLength: 255 }),
  redactedPreview: Type.String({ maxLength: 4_096 }),
  visibility: VisibilitySchema,
  contentEncoding: Type.Literal("base64"),
  content: Type.String({ maxLength: 134_217_728 }),
}, { additionalProperties: false });

export const ReplayBundleSchema = Type.Object({
  schemaVersion: Type.Literal(REPLAY_BUNDLE_VERSION),
  projectorVersion: Type.Literal(REPLAY_PROJECTOR_VERSION),
  runId: IdentifierSchema,
  terminal: Type.Object({
    kind: Type.Union([Type.Literal("completed"), Type.Literal("cancelled")]),
    eventId: IdentifierSchema,
  }, { additionalProperties: false }),
  perspective: Type.Object({
    mode: Type.Union([
      Type.Literal("clean"),
      Type.Literal("unblinded"),
      Type.Literal("post_match_reveal"),
    ]),
    benchmarkEligible: Type.Boolean(),
  }, { additionalProperties: false }),
  deliveries: Type.Array(EventDeliverySchema, { maxItems: 100_000 }),
  artifacts: Type.Array(ReplayArtifactSchema, { maxItems: 4_096 }),
}, { additionalProperties: false });

export type ReplayArtifact = {
  readonly digest: `sha256:${string}`;
  readonly byteCount: number;
  readonly mediaType: string;
  readonly redactedPreview: string;
  readonly visibility: EventEnvelope["visibility"];
  readonly contentEncoding: "base64";
  readonly content: string;
};

export interface ReplayBundle {
  readonly schemaVersion: typeof REPLAY_BUNDLE_VERSION;
  readonly projectorVersion: typeof REPLAY_PROJECTOR_VERSION;
  readonly runId: string;
  readonly terminal: {
    readonly kind: "completed" | "cancelled";
    readonly eventId: string;
  };
  readonly perspective: {
    readonly mode: "clean" | "unblinded" | "post_match_reveal";
    readonly benchmarkEligible: boolean;
  };
  readonly deliveries: readonly EventDelivery[];
  readonly artifacts: readonly ReplayArtifact[];
}

export interface ReplayBundleError {
  readonly code: "INVALID_REPLAY_BUNDLE" | "UNSUPPORTED_REPLAY_BUNDLE_VERSION";
  readonly message: string;
  readonly issues: readonly string[];
}

export type ReplayBundleParseResult =
  | { readonly ok: true; readonly value: ReplayBundle }
  | { readonly ok: false; readonly error: ReplayBundleError };

const validator = Schema.Compile(ReplayBundleSchema);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function semanticIssues(bundle: ReplayBundle): string[] {
  const issues: string[] = [];
  const eventIds = new Set<string>();
  const referencedDigests = new Set<string>();
  bundle.deliveries.forEach((delivery, index) => {
    if (delivery.deliverySequence !== index + 1) issues.push("delivery_sequence");
    if (delivery.event.runId !== bundle.runId) issues.push("delivery_run_id");
    if (eventIds.has(delivery.event.eventId)) issues.push("duplicate_event_id");
    eventIds.add(delivery.event.eventId);
    for (const digest of delivery.event.artifactDigests) referencedDigests.add(digest);
  });
  const terminalEvent = bundle.deliveries.find(
    ({ event }) => event.eventId === bundle.terminal.eventId,
  )?.event;
  const expectedKind = bundle.terminal.kind === "completed"
    ? "match.completed"
    : "run.cancelled";
  if (terminalEvent?.kind !== expectedKind) issues.push("terminal_event");
  if (bundle.perspective.mode === "clean" && !bundle.perspective.benchmarkEligible) {
    issues.push("clean_benchmark_eligibility");
  }
  if (bundle.perspective.mode === "unblinded" && bundle.perspective.benchmarkEligible) {
    issues.push("unblinded_benchmark_eligibility");
  }
  const artifactDigests = new Set<string>();
  for (const artifact of bundle.artifacts) {
    if (artifactDigests.has(artifact.digest)) issues.push("duplicate_artifact");
    artifactDigests.add(artifact.digest);
  }
  for (const digest of referencedDigests) {
    if (!artifactDigests.has(digest)) issues.push("missing_artifact");
  }
  for (const digest of artifactDigests) {
    if (!referencedDigests.has(digest)) issues.push("unreferenced_artifact");
  }
  return [...new Set(issues)].sort();
}

export function parseReplayBundle(input: unknown): ReplayBundleParseResult {
  if (
    isRecord(input) && typeof input.schemaVersion === "string" &&
    input.schemaVersion !== REPLAY_BUNDLE_VERSION
  ) {
    return {
      ok: false,
      error: {
        code: "UNSUPPORTED_REPLAY_BUNDLE_VERSION",
        message: "Replay bundle version is unsupported.",
        issues: ["schema_version"],
      },
    };
  }
  if (!validator.Check(input)) {
    return {
      ok: false,
      error: {
        code: "INVALID_REPLAY_BUNDLE",
        message: "Replay bundle failed structural validation.",
        issues: ["structure"],
      },
    };
  }
  const bundle = input as ReplayBundle;
  const issues = semanticIssues(bundle);
  return issues.length === 0
    ? { ok: true, value: bundle }
    : {
        ok: false,
        error: {
          code: "INVALID_REPLAY_BUNDLE",
          message: "Replay bundle failed consistency validation.",
          issues,
        },
      };
}

export function serializeReplayBundle(bundle: ReplayBundle): string {
  const parsed = parseReplayBundle(bundle);
  if (!parsed.ok) throw new Error(parsed.error.message);
  return `${JSON.stringify(parsed.value)}\n`;
}
