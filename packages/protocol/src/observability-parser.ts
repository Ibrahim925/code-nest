import Schema from "typebox/schema";

import {
  parseEventEnvelope,
  type EnvelopeError,
  type ParseResult,
} from "./envelope-parser.js";
import {
  normalizeIssues,
  sortUniqueIssues,
  type RawValidationIssue,
  type ValidationIssue,
} from "./envelope-validation.js";
import { observabilityPolicyIssues } from "./observability-policy.js";
import {
  ObservabilityPayloadSchemas,
  type ObservabilityEvent,
  type ObservabilityEventKind,
} from "./observability-schemas.js";

export interface UnsupportedObservabilityEventKindError {
  code: "UNSUPPORTED_OBSERVABILITY_EVENT_KIND";
  message: string;
  receivedKind: string;
  supportedKinds: readonly ObservabilityEventKind[];
  issues: ValidationIssue[];
}

export interface InvalidObservabilityEventError {
  code: "INVALID_OBSERVABILITY_EVENT";
  message: string;
  issues: ValidationIssue[];
}

export type ObservabilityEventError =
  | EnvelopeError
  | UnsupportedObservabilityEventKindError
  | InvalidObservabilityEventError;

const validators = {
  "match.phase_advanced": Schema.Compile(
    ObservabilityPayloadSchemas["match.phase_advanced"],
  ),
  "runtime.activity_reported": Schema.Compile(
    ObservabilityPayloadSchemas["runtime.activity_reported"],
  ),
  "runtime.rationale_submitted": Schema.Compile(
    ObservabilityPayloadSchemas["runtime.rationale_submitted"],
  ),
  "runtime.tool_observed": Schema.Compile(
    ObservabilityPayloadSchemas["runtime.tool_observed"],
  ),
  "runtime.computer_frame_captured": Schema.Compile(
    ObservabilityPayloadSchemas["runtime.computer_frame_captured"],
  ),
  "memory.updated": Schema.Compile(ObservabilityPayloadSchemas["memory.updated"]),
  "message.published": Schema.Compile(
    ObservabilityPayloadSchemas["message.published"],
  ),
  "town_hall.started": Schema.Compile(
    ObservabilityPayloadSchemas["town_hall.started"],
  ),
  "town_hall.turn_recorded": Schema.Compile(
    ObservabilityPayloadSchemas["town_hall.turn_recorded"],
  ),
} as const;

const supportedKinds = Object.freeze(
  Object.keys(validators) as ObservabilityEventKind[],
);

function isObservabilityKind(value: string): value is ObservabilityEventKind {
  return Object.hasOwn(validators, value);
}

function rawPayloadIssues(
  kind: ObservabilityEventKind,
  payload: unknown,
): RawValidationIssue[] {
  const validator = validators[kind];
  if (validator.Check(payload)) return [];
  const [, errors] = validator.Errors(payload);
  return errors;
}

function prefixPayloadPath(issue: ValidationIssue): ValidationIssue {
  return { ...issue, path: `/payload${issue.path}` };
}

export function parseObservabilityEvent(
  input: unknown,
): ParseResult<ObservabilityEvent, ObservabilityEventError> {
  const parsed = parseEventEnvelope(input);
  if (!parsed.ok) return parsed;
  const event = parsed.value;
  if (!isObservabilityKind(event.kind)) {
    return {
      ok: false,
      error: {
        code: "UNSUPPORTED_OBSERVABILITY_EVENT_KIND",
        message: `Event kind "${event.kind}" is not an Observatory contract.`,
        receivedKind: event.kind,
        supportedKinds,
        issues: [
          {
            code: "unsupported_event_kind",
            message: "Expected a supported Observatory event kind.",
            path: "/kind",
          },
        ],
      },
    };
  }
  const payloadIssues = normalizeIssues(
    rawPayloadIssues(event.kind, event.payload),
  ).map(prefixPayloadPath);
  if (payloadIssues.length > 0) {
    return {
      ok: false,
      error: {
        code: "INVALID_OBSERVABILITY_EVENT",
        message: "Observability event payload failed validation.",
        issues: payloadIssues,
      },
    };
  }

  const observableEvent = event as ObservabilityEvent;
  const policyIssues = sortUniqueIssues(
    observabilityPolicyIssues(observableEvent),
  );
  if (policyIssues.length === 0) return { ok: true, value: observableEvent };
  return {
    ok: false,
    error: {
      code: "INVALID_OBSERVABILITY_EVENT",
      message: "Observability event violated its visibility or provenance policy.",
      issues: policyIssues,
    },
  };
}
