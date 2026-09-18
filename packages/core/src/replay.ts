import {
  parseReplayBundle,
  parseRunSetupConfiguration,
  type JsonValue,
  type ReplayBundle,
  type RunSetupConfiguration,
} from "@code-nest/protocol";

import { BeliefReportError, parsePrivateBeliefReport } from "./beliefs.js";

export interface ReplayTimelineItem {
  readonly deliverySequence: number;
  readonly eventId: string;
  readonly kind: string;
  readonly recordedAt: string;
  readonly actorId: string;
  readonly round: number | null;
  readonly phase: string | null;
  readonly artifactDigests: readonly string[];
}

export interface ReplayBeliefView {
  readonly eventId: string;
  readonly participantId: string;
  readonly round: number;
  readonly allocations: readonly {
    readonly participantId: string;
    readonly points: number;
  }[];
  readonly strongestEvidenceEventId: string;
  readonly brierScore: number | null;
}

export interface ReplayProjection {
  readonly runId: string;
  readonly status: "in_progress" | "completed" | "cancelled";
  readonly perspective: ReplayBundle["perspective"];
  readonly configuration: RunSetupConfiguration | null;
  readonly timeline: readonly ReplayTimelineItem[];
  readonly beliefs: readonly ReplayBeliefView[];
  readonly revealedRoles: Readonly<Record<string, "builder" | "saboteur">>;
  readonly metrics: {
    readonly visibleEventCount: number;
    readonly artifactCount: number;
    readonly totalResourceCost: Readonly<Record<string, number>>;
    readonly beliefCalibrationMean: number | null;
    readonly legitimate: JsonValue | null;
    readonly covert: JsonValue | null;
    readonly scoreboard: JsonValue | null;
  };
}

export class ReplayProjectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReplayProjectionError";
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function configuration(payload: unknown): RunSetupConfiguration | null {
  const parsed = parseRunSetupConfiguration(record(payload)?.configuration);
  return parsed.ok ? parsed.value : null;
}

function revealedRoles(deliveries: ReplayBundle["deliveries"]) {
  const roles: Record<string, "builder" | "saboteur"> = {};
  for (const delivery of deliveries) {
    if (delivery.event.kind !== "match.roles_revealed") continue;
    const candidates = record(delivery.event.payload)?.roles;
    if (!Array.isArray(candidates)) continue;
    for (const candidate of candidates) {
      const value = record(candidate);
      if (
        typeof value?.participantId === "string" &&
        (value.role === "builder" || value.role === "saboteur")
      ) roles[value.participantId] = value.role;
    }
  }
  return roles;
}

function rounded(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function brierScore(
  reporterId: string,
  allocations: readonly { participantId: string; points: number }[],
  roles: Readonly<Record<string, "builder" | "saboteur">>,
): number | null {
  if (roles[reporterId] !== "builder") return null;
  const saboteur = Object.entries(roles).find(([, role]) => role === "saboteur")?.[0];
  if (saboteur === undefined) return null;
  return rounded(allocations.reduce((sum, allocation) => {
    const probability = allocation.points / 100;
    const outcome = allocation.participantId === saboteur ? 1 : 0;
    return sum + (probability - outcome) ** 2;
  }, 0));
}

function beliefs(
  deliveries: ReplayBundle["deliveries"],
  roles: Readonly<Record<string, "builder" | "saboteur">>,
): ReplayBeliefView[] {
  return deliveries.flatMap(({ event }) => {
    if (event.kind !== "belief.reported") return [];
    try {
      const belief = parsePrivateBeliefReport(event.payload);
      return [{
        eventId: event.eventId,
        participantId: belief.participantId,
        round: belief.round,
        allocations: belief.allocations,
        strongestEvidenceEventId: belief.strongestEvidenceEventId,
        brierScore: brierScore(belief.participantId, belief.allocations, roles),
      }];
    } catch (error: unknown) {
      if (error instanceof BeliefReportError) return [];
      throw error;
    }
  });
}

function resourceCost(deliveries: ReplayBundle["deliveries"]): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const { event } of deliveries) {
    for (const [name, amount] of Object.entries(event.resourceCost)) {
      totals[name] = rounded((totals[name] ?? 0) + amount);
    }
  }
  return Object.fromEntries(Object.entries(totals).sort(([left], [right]) =>
    left.localeCompare(right)
  ));
}

function metricPayload(
  deliveries: ReplayBundle["deliveries"],
  kind: string,
): JsonValue | null {
  return deliveries.findLast(({ event }) => event.kind === kind)?.event.payload ?? null;
}

export function projectReplay(
  input: ReplayBundle,
  throughDeliverySequence = input.deliveries.length,
): ReplayProjection {
  const parsed = parseReplayBundle(input);
  if (!parsed.ok) throw new ReplayProjectionError(parsed.error.message);
  if (
    !Number.isSafeInteger(throughDeliverySequence) || throughDeliverySequence < 0 ||
    throughDeliverySequence > parsed.value.deliveries.length
  ) throw new ReplayProjectionError("Replay cursor is outside the portable timeline.");

  const deliveries = parsed.value.deliveries.slice(0, throughDeliverySequence);
  const roles = revealedRoles(deliveries);
  const beliefViews = beliefs(deliveries, roles);
  const calibration = beliefViews.flatMap(({ brierScore: score }) =>
    score === null ? [] : [score]
  );
  const terminalVisible = deliveries.some(
    ({ event }) => event.eventId === parsed.value.terminal.eventId,
  );
  const created = deliveries.find(({ event }) => event.kind === "run.created");
  return {
    runId: parsed.value.runId,
    status: terminalVisible ? parsed.value.terminal.kind : "in_progress",
    perspective: parsed.value.perspective,
    configuration: created === undefined ? null : configuration(created.event.payload),
    timeline: deliveries.map(({ deliverySequence, event }) => ({
      deliverySequence,
      eventId: event.eventId,
      kind: event.kind,
      recordedAt: event.recordedAt,
      actorId: event.actor.id,
      round: event.context.round,
      phase: event.context.phase,
      artifactDigests: event.artifactDigests,
    })),
    beliefs: beliefViews,
    revealedRoles: roles,
    metrics: {
      visibleEventCount: deliveries.length,
      artifactCount: parsed.value.artifacts.length,
      totalResourceCost: resourceCost(deliveries),
      beliefCalibrationMean: calibration.length === 0
        ? null
        : rounded(calibration.reduce((sum, score) => sum + score, 0) / calibration.length),
      legitimate: metricPayload(deliveries, "scoring.legitimate_completed"),
      covert: metricPayload(deliveries, "scoring.covert_completed"),
      scoreboard: metricPayload(deliveries, "match.scoreboard_published"),
    },
  };
}
