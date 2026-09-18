export const DEFAULT_EVENT_WINDOW_SIZE = 80;

export interface EventWindow<T> {
  readonly items: readonly T[];
  readonly start: number;
  readonly end: number;
  readonly total: number;
  readonly size: number;
  readonly hiddenBefore: number;
  readonly hiddenAfter: number;
}

function windowSize(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 200) {
    throw new Error("An event window must contain between 1 and 200 rows.");
  }
  return value;
}

export function projectEventWindow<T>(
  items: readonly T[],
  requestedEnd = items.length,
  requestedSize = DEFAULT_EVENT_WINDOW_SIZE,
): EventWindow<T> {
  const size = windowSize(requestedSize);
  const end = Number.isSafeInteger(requestedEnd)
    ? Math.max(0, Math.min(requestedEnd, items.length))
    : items.length;
  const start = Math.max(0, end - size);
  return {
    items: items.slice(start, end),
    start,
    end,
    total: items.length,
    size,
    hiddenBefore: start,
    hiddenAfter: items.length - end,
  };
}

export function previousEventWindowEnd(window: EventWindow<unknown>): number {
  return window.start;
}

export function nextEventWindowEnd(window: EventWindow<unknown>): number {
  return Math.min(window.total, window.end + window.size);
}
