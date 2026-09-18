import type { DecodedEventDelivery } from "../../events/domain/live-events.js";

export const DELIVERY_LATENCY_TARGET_MS = 2_000;
export const DELIVERY_ON_TIME_TARGET = 0.95;

export interface DeliveryLatencyState {
  readonly measuredCount: number;
  readonly onTimeCount: number;
  readonly delayedCount: number;
  readonly latestLatencyMilliseconds: number | null;
  readonly lastDeliverySequence: number;
}

type UnknownRecord = Readonly<Record<string, unknown>>;

function record(value: unknown): UnknownRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

export function createDeliveryLatencyState(): DeliveryLatencyState {
  return {
    measuredCount: 0,
    onTimeCount: 0,
    delayedCount: 0,
    latestLatencyMilliseconds: null,
    lastDeliverySequence: 0,
  };
}

export function projectDeliveryLatency(
  state: DeliveryLatencyState,
  delivery: DecodedEventDelivery,
  receivedAtEpochMilliseconds: number,
): DeliveryLatencyState {
  if (delivery.deliverySequence <= state.lastDeliverySequence) return state;
  const recordedAt = record(delivery.event)?.recordedAt;
  const recordedAtEpoch = typeof recordedAt === "string" ? Date.parse(recordedAt) : Number.NaN;
  if (!Number.isFinite(recordedAtEpoch) || !Number.isFinite(receivedAtEpochMilliseconds)) {
    return { ...state, lastDeliverySequence: delivery.deliverySequence };
  }
  const latency = Math.max(0, receivedAtEpochMilliseconds - recordedAtEpoch);
  const onTime = latency <= DELIVERY_LATENCY_TARGET_MS;
  return {
    measuredCount: state.measuredCount + 1,
    onTimeCount: state.onTimeCount + (onTime ? 1 : 0),
    delayedCount: state.delayedCount + (onTime ? 0 : 1),
    latestLatencyMilliseconds: latency,
    lastDeliverySequence: delivery.deliverySequence,
  };
}

export function deliveryOnTimeRatio(state: DeliveryLatencyState): number | null {
  return state.measuredCount === 0 ? null : state.onTimeCount / state.measuredCount;
}

export function deliveryLatencyLabel(state: DeliveryLatencyState): string {
  const ratio = deliveryOnTimeRatio(state);
  if (ratio === null) return "Delivery timing awaiting first event";
  const percent = (ratio * 100).toFixed(1);
  const result = ratio >= DELIVERY_ON_TIME_TARGET ? "target met" : "below target";
  return `${percent}% within 2 seconds · ${result}`;
}
