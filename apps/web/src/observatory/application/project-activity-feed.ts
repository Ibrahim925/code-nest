import type { DecodedEventDelivery } from "../../events/domain/live-events.js";
import type {
  ActivityArtifact,
  ActivityFeedState,
  ActivityItem,
  SanitizedText,
  VerificationLabel,
} from "../domain/activity-feed.js";
import {
  sanitizeFilename,
  sanitizeUntrustedText,
} from "./sanitize-untrusted-text.js";

type UnknownRecord = Readonly<Record<string, unknown>>;
type ItemDraft = Omit<
  ActivityItem,
  "id" | "eventId" | "deliverySequence" | "participantId" | "recordedAt" |
  "round" | "phase" | "visibility" | "causationId" | "correlationId" |
  "parentEventIds" | "artifacts" | "resourceCost"
> & { readonly participantId?: string | null };

const DIGEST = /^sha256:[a-f0-9]{64}$/;

function record(value: unknown): UnknownRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function shortText(value: unknown, maximum = 160): string | null {
  const sanitized = sanitizeUntrustedText(value, maximum);
  return sanitized !== null && !sanitized.truncated
    ? sanitized.text.replaceAll("\n", " ").replaceAll("\t", " ")
    : null;
}

function identifier(value: unknown): string | null {
  const candidate = shortText(value);
  return candidate !== null && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(candidate)
    ? candidate
    : null;
}

function artifacts(value: unknown): readonly ActivityArtifact[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((digest) =>
    typeof digest === "string" && DIGEST.test(digest)
      ? [{ digest: digest as `sha256:${string}`, preview: "load_on_demand" as const }]
      : []);
}

function resourceCost(value: unknown): Readonly<Record<string, number>> {
  const source = record(value);
  if (source === null) return {};
  return Object.fromEntries(
    Object.entries(source).filter((entry): entry is [string, number] =>
      /^[A-Za-z0-9._-]{1,80}$/.test(entry[0]) &&
      typeof entry[1] === "number" &&
      Number.isFinite(entry[1]) &&
      entry[1] >= 0),
  );
}

function factualItem(
  title: string,
  category: ItemDraft["category"],
  body: SanitizedText | null,
  verification: VerificationLabel,
  provenance: string,
  participantId?: string | null,
): ItemDraft {
  return {
    title,
    category,
    body,
    verification,
    provenance,
    ...(participantId === undefined ? {} : { participantId }),
  };
}

function workCaptured(payload: UnknownRecord): readonly ItemDraft[] {
  const participantId = identifier(payload.participantId);
  const turn = record(payload.turn);
  if (participantId === null || turn === null) return [];
  const revision = identifier(turn.candidateRevision);
  const summary = sanitizeUntrustedText(turn.commitSummary, 500);
  const commitBody = summary === null && revision === null
    ? null
    : sanitizeUntrustedText(
      `${summary?.text ?? "Commit captured"}${revision === null ? "" : `\nRevision ${revision}`}`,
      700,
    );
  const drafts: ItemDraft[] = [factualItem(
    "Captured commit",
    "commit",
    commitBody,
    "attributed",
    "Controller workspace capture",
    participantId,
  )];
  if (Array.isArray(turn.publicMessages)) {
    for (const message of turn.publicMessages) {
      const body = sanitizeUntrustedText(message, 1_000);
      if (body !== null) drafts.push(factualItem(
        "Public message",
        "message",
        body,
        "self-report",
        "Participant-submitted message · self-report",
        participantId,
      ));
    }
  }
  const usage = record(turn.usage);
  if (usage !== null) {
    const input = usage.inputTokens;
    const output = usage.outputTokens;
    const time = usage.wallTimeMilliseconds;
    if ([input, output, time].every((item) => Number.isSafeInteger(item) && Number(item) >= 0)) {
      drafts.push(factualItem(
        "Measured usage",
        "usage",
        sanitizeUntrustedText(`Input ${input} · Output ${output} · Wall ${time} ms`, 200),
        "observed",
        "Runtime adapter measurement",
        participantId,
      ));
    }
  }
  return drafts;
}

function runtimeDraft(
  kind: string,
  payload: UnknownRecord,
): readonly ItemDraft[] {
  const participantId = identifier(payload.participantId);
  if (participantId === null) return [];
  if (kind === "runtime.work_note") {
    const body = sanitizeUntrustedText(payload.body, 2_000);
    return body === null ? [] : [factualItem(
      "Work note", "work_note", body, "self-report",
      "Agent-authored work note · self-report", participantId,
    )];
  }
  if (kind === "runtime.reasoning_summary") {
    const body = sanitizeUntrustedText(payload.body, 2_000);
    const provider = shortText(payload.provider);
    const model = shortText(payload.model);
    const adapter = shortText(payload.adapter);
    return body === null || provider === null || model === null || adapter === null
      ? []
      : [factualItem(
        "Provider reasoning summary", "reasoning_summary", body, "self-report",
        `${provider} · ${model} · ${adapter} · provider summary`, participantId,
      )];
  }
  if (kind === "runtime.command") {
    const body = sanitizeUntrustedText(payload.command, 1_000);
    return body === null ? [] : [factualItem(
      "Command", "command", body, "observed", "Runtime adapter observation", participantId,
    )];
  }
  if (kind === "runtime.terminal_output") {
    const body = sanitizeUntrustedText(payload.text, 4_096, true);
    const stream = payload.stream === "stderr" ? "stderr" : "stdout";
    return body === null ? [] : [factualItem(
      `Terminal · ${stream}`, "terminal", body, "observed",
      "Sanitized runtime output", participantId,
    )];
  }
  if (kind === "runtime.file_changed") {
    const filename = sanitizeFilename(payload.path);
    const change = shortText(payload.change, 40);
    return filename === null || change === null ? [] : [factualItem(
      "File change", "file_change", sanitizeUntrustedText(`${change} · ${filename}`, 300),
      "observed", "Workspace observation", participantId,
    )];
  }
  if (kind === "runtime.test_completed") {
    const body = sanitizeUntrustedText(payload.summary, 1_000);
    const status = shortText(payload.status, 40);
    return body === null || status === null ? [] : [factualItem(
      `Local test · ${status}`, "test", body, "self-report",
      "Participant-local test · untrusted self-report", participantId,
    )];
  }
  return [];
}

function drafts(kind: string, payload: UnknownRecord): readonly ItemDraft[] {
  if (kind === "participant.work_captured") return workCaptured(payload);
  const runtime = runtimeDraft(kind, payload);
  if (runtime.length > 0) return runtime;
  if (kind === "message.published") {
    const participantId = identifier(payload.participantId);
    const body = sanitizeUntrustedText(payload.body, 1_000);
    return participantId === null || body === null ? [] : [factualItem(
      "Published message", "message", body, "self-report",
      "Participant-submitted message · self-report", participantId,
    )];
  }
  if (kind === "recovery.outcome_recorded") {
    const reason = shortText(payload.reason, 80);
    const status = shortText(payload.status, 40);
    const summary = sanitizeUntrustedText(payload.summary, 300);
    if (reason === null || status === null || summary === null ||
      typeof payload.retryRequired !== "boolean") return [];
    const retry = payload.retryRequired ? "Declared retry required" : "No automatic retry";
    return [factualItem(
      `Recovery · ${reason.replaceAll("_", " ")}`,
      "recovery",
      sanitizeUntrustedText(`${summary.text}\n${status} · ${retry}`, 500),
      "trusted",
      "Controller recovery coordinator",
      identifier(payload.participantId),
    )];
  }
  return [];
}

export function createActivityFeedState(): ActivityFeedState {
  return { items: [], lastDeliverySequence: 0 };
}

export function projectActivityFeed(
  state: ActivityFeedState,
  delivery: DecodedEventDelivery,
): ActivityFeedState {
  if (delivery.deliverySequence <= state.lastDeliverySequence) return state;
  const event = record(delivery.event);
  const kind = shortText(event?.kind);
  const payload = record(event?.payload);
  if (event === null || kind === null || payload === null) {
    return { ...state, lastDeliverySequence: delivery.deliverySequence };
  }
  const actor = record(event.actor);
  const context = record(event.context);
  const visibility = record(event.visibility);
  const linkedArtifacts = artifacts(event.artifactDigests);
  let eventDrafts = drafts(kind, payload);
  if (eventDrafts.length === 0 && linkedArtifacts.length > 0) {
    eventDrafts = [factualItem(
      `Artifact reference · ${kind}`, "artifact", null, "trusted",
      "Controller artifact reference", identifier(actor?.id),
    )];
  }
  const eventId = identifier(event.eventId) ?? delivery.eventId;
  const baseParticipant = actor?.kind === "participant" ? identifier(actor.id) : null;
  const items = eventDrafts.map((draft, index): ActivityItem => ({
    ...draft,
    id: `${eventId}:${index + 1}`,
    eventId,
    deliverySequence: delivery.deliverySequence,
    participantId: draft.participantId === undefined ? baseParticipant : draft.participantId,
    recordedAt: shortText(event.recordedAt),
    round: Number.isSafeInteger(context?.round) ? Number(context?.round) : null,
    phase: shortText(context?.phase, 80),
    visibility: shortText(visibility?.class, 80) ?? "unknown",
    causationId: identifier(event.causationId),
    correlationId: identifier(event.correlationId),
    parentEventIds: Array.isArray(event.parentEventIds)
      ? event.parentEventIds.flatMap((parent) => {
        const id = identifier(parent);
        return id === null ? [] : [id];
      })
      : [],
    artifacts: linkedArtifacts,
    resourceCost: resourceCost(event.resourceCost),
  }));
  return {
    items: [...state.items, ...items],
    lastDeliverySequence: delivery.deliverySequence,
  };
}
