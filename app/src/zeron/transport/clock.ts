// Ported from zeron@853872d — transport timer/clock abstraction so every
// liveness/backoff deadline in the sync clients is deterministic under Jest
// (mirrors the DispatchTime-driven constants in crates/sync/src/*.rs).

export type TimerHandle = unknown;

export interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms: number): TimerHandle;
  clearTimeout(handle: TimerHandle): void;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: h => clearTimeout(h as ReturnType<typeof setTimeout>),
};

interface FakeTimer {
  at: number;
  fn: () => void;
  cancelled: boolean;
}

/** Deterministic clock: `advance(ms)` runs every timer whose deadline
 * falls inside the window, in deadline order (timers scheduled by running
 * timers inside the window run too). */
export class FakeClock implements Clock {
  private t: number;
  private timers: FakeTimer[] = [];

  constructor(now = 0) {
    this.t = now;
  }

  now(): number {
    return this.t;
  }

  setTimeout(fn: () => void, ms: number): TimerHandle {
    const timer: FakeTimer = {
      at: this.t + Math.max(0, ms),
      fn,
      cancelled: false,
    };
    this.timers.push(timer);
    return timer;
  }

  clearTimeout(handle: TimerHandle): void {
    (handle as FakeTimer).cancelled = true;
  }

  /** Advance the clock, firing due timers in order. Returns `now`. */
  advance(ms: number): number {
    const target = this.t + ms;
    for (;;) {
      let next: FakeTimer | undefined;
      for (const timer of this.timers) {
        if (
          !timer.cancelled &&
          timer.at <= target &&
          (next === undefined || timer.at < next.at)
        ) {
          next = timer;
        }
      }
      if (next === undefined) break;
      this.timers.splice(this.timers.indexOf(next), 1);
      this.t = next.at;
      next.fn();
    }
    this.t = target;
    this.timers = this.timers.filter(t => !t.cancelled);
    return this.t;
  }

  get pendingCount(): number {
    return this.timers.filter(t => !t.cancelled).length;
  }
}
