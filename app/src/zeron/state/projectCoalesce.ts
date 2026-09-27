// Batch expensive session projections so a burst of chat2 / transcript
// frames shares one toJSON + React commit. Same-tick loops collapse via
// queueMicrotask (Jest `flush()` drains it). Later turns inside the quiet
// window wait for the injected Clock timer so FakeClock tests that never
// `advance()` still see the microtask write and the leftover timer is a
// no-op. User-initiated writes call `flush()` and project immediately.

import type { Clock } from '../transport/clock';

/** Trailing quiet window so streaming WS turns share one projection.
 * Steady traffic projects once per window (~30Hz), not once per frame. */
export const PROJECT_COALESCE_MS = 32;

export class ProjectCoalesce {
  private dirty = false;
  private microQueued = false;
  private trail: unknown;

  constructor(
    private readonly clock: Clock,
    private readonly run: () => void,
  ) {}

  /** Incoming row/frame: the first turn in a burst projects on a microtask;
   * later turns in the quiet window wait for the Clock timer. After each
   * timed flush a new window is armed so a steady stream does not project
   * again on the very next microtask. */
  schedule(): void {
    this.dirty = true;
    if (this.trail !== undefined || this.microQueued) return;
    this.microQueued = true;
    queueMicrotask(() => {
      this.microQueued = false;
      if (this.trail !== undefined) return;
      this.flushIfDue();
      this.arm();
    });
  }

  /** User-initiated write: project now so the caller can read the store. */
  flush(): void {
    this.dirty = false;
    this.microQueued = false;
    this.clearTrail();
    this.run();
  }

  dispose(): void {
    this.dirty = false;
    this.microQueued = false;
    this.clearTrail();
  }

  private arm(): void {
    if (this.trail !== undefined) return;
    this.trail = this.clock.setTimeout(() => {
      this.trail = undefined;
      if (!this.dirty) return;
      this.flushIfDue();
      this.arm();
    }, PROJECT_COALESCE_MS);
  }

  private flushIfDue(): void {
    if (!this.dirty) return;
    this.dirty = false;
    this.run();
  }

  private clearTrail(): void {
    if (this.trail === undefined) return;
    this.clock.clearTimeout(this.trail);
    this.trail = undefined;
  }
}
