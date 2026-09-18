import type { FrameScheduler } from "../application/frame-batcher.js";

export const animationFrameScheduler: FrameScheduler = {
  request(work) {
    const frame = window.requestAnimationFrame(work);
    return () => window.cancelAnimationFrame(frame);
  },
};
