export interface FrameScheduler {
  readonly request: (work: () => void) => () => void;
}

export interface FrameBatcher<T> {
  readonly push: (item: T) => void;
  readonly stop: () => void;
}

export function createFrameBatcher<T>(
  scheduler: FrameScheduler,
  consume: (items: readonly T[]) => void,
): FrameBatcher<T> {
  let queued: T[] = [];
  let cancelPending: (() => void) | null = null;
  let stopped = false;

  const flush = (): void => {
    cancelPending = null;
    if (stopped || queued.length === 0) return;
    const batch = queued;
    queued = [];
    consume(batch);
  };

  return {
    push(item) {
      if (stopped) return;
      queued.push(item);
      cancelPending ??= scheduler.request(flush);
    },
    stop() {
      stopped = true;
      queued = [];
      cancelPending?.();
      cancelPending = null;
    },
  };
}
