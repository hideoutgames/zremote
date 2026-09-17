// Live Activity manager — pure planning + a thin driver seam.
//
// `planActivity` decides what to do on each observed session change; the
// `LiveActivityDriver` interface hides expo-widgets so the policy is fully
// unit-testable. Runtime wiring lives in `bindLiveActivities.ts`.
//
// Policy (docs/NATIVE_MODULES.md):
//  - start when a session enters `working`/`awaitingInput` (dedupe by chatId)
//  - `working` updates throttled to one per 5s; awaitingInput/errored/
//    completed are immediate
//  - completed → end after(now+30min); errored → end default; user archive →
//    'immediate'
//  - staleDate on updates: now+120s (mirrors the edge's stale-date)
//  - if the OS refuses a start (limit/disabled), we fall back to ONE
//    aggregate activity bound to the currently-selected session

import type {
  SessionActivityPhase,
  SessionActivityProps,
} from './SessionActivity';

export const WORKING_UPDATE_MIN_MS = 5_000;
export const STALE_AFTER_MS = 120_000;
export const COMPLETED_DISMISS_MS = 30 * 60_000;

export type ActivityAction =
  | { kind: 'start'; props: SessionActivityProps }
  | { kind: 'update'; props: SessionActivityProps }
  | { kind: 'end'; outcome: 'completed' | 'errored' | 'immediate' }
  | { kind: 'none' };

export type ActivityState = {
  phase: SessionActivityPhase;
  /** last wall-clock ms we pushed an update. */
  lastUpdateAt: number;
};

/** Decide the next action given the previously-applied activity phase. */
export const planActivity = (
  prev: ActivityState | undefined,
  next: SessionActivityProps,
  now: number,
): ActivityAction => {
  if (prev === undefined) {
    if (next.phase === 'working' || next.phase === 'awaitingInput') {
      return { kind: 'start', props: next };
    }
    return { kind: 'none' };
  }
  if (next.phase === 'completed' || next.phase === 'errored') {
    return { kind: 'end', outcome: next.phase };
  }
  if (prev.phase === next.phase && next.phase === 'working') {
    // throttle routine working updates
    if (now - prev.lastUpdateAt < WORKING_UPDATE_MIN_MS) {
      return { kind: 'none' };
    }
    return { kind: 'update', props: next };
  }
  if (next.phase === 'stale' && prev.phase === 'stale') return { kind: 'none' };
  return { kind: 'update', props: next };
};

export interface LiveActivityHandle {
  getId(): string;
  update(props: SessionActivityProps, staleDate?: Date): Promise<void>;
  end(
    policy: 'default' | 'immediate' | { after: Date },
    props?: SessionActivityProps,
  ): Promise<void>;
  addPushTokenListener(
    cb: (e: { activityId: string; pushToken: string }) => void,
  ): {
    remove(): void;
  };
}

export interface LiveActivityDriver {
  start(
    props: SessionActivityProps,
    url?: string,
    staleDate?: Date,
  ): LiveActivityHandle;
  getInstances(): LiveActivityHandle[];
  after(date: Date): { after: Date };
}

export type LiveActivityCallbacks = {
  /** Register an activity push token with the edge. */
  onPushToken(chatId: string, token: string): void;
  /** Unregister when the activity ends. */
  onUnregister(chatId: string): void;
  /** Currently-selected chat for the aggregate fallback. */
  selectedChatId(): string | undefined;
};

const activityUrl = (chatId: string): string => `zeron://session/${chatId}`;

export class LiveActivityManager {
  private states = new Map<string, ActivityState>();
  private handles = new Map<string, LiveActivityHandle>();
  private tokenSubs = new Map<string, { remove(): void }>();
  private aggregate: LiveActivityHandle | undefined;
  private aggregateFor: string | undefined;

  constructor(
    private driver: LiveActivityDriver,
    private cb: LiveActivityCallbacks,
    private now: () => number = () => Date.now(),
  ) {}

  /** Feed the latest props for a session; call with `null` on archive. */
  apply(chatId: string, next: SessionActivityProps | null): void {
    const prev = this.states.get(chatId);
    if (next === null) {
      this.end(chatId, 'immediate');
      return;
    }
    const action = planActivity(prev, next, this.now());
    switch (action.kind) {
      case 'start':
        this.start(chatId, action.props);
        break;
      case 'update': {
        const h =
          this.handles.get(chatId) ??
          (this.aggregateFor === chatId ? this.aggregate : undefined);
        h?.update(action.props, new Date(this.now() + STALE_AFTER_MS)).catch(
          () => {},
        );
        this.states.set(chatId, {
          phase: next.phase,
          lastUpdateAt: this.now(),
        });
        break;
      }
      case 'end':
        this.end(chatId, action.outcome);
        break;
      case 'none':
        break;
    }
  }

  private start(chatId: string, props: SessionActivityProps): void {
    let handle: LiveActivityHandle;
    try {
      handle = this.driver.start(
        props,
        activityUrl(chatId),
        new Date(this.now() + STALE_AFTER_MS),
      );
    } catch {
      // OS refused (limit/disabled): fall back to the single aggregate
      // activity for the selected session.
      if (this.cb.selectedChatId() === chatId && this.aggregate !== undefined) {
        this.aggregateFor = chatId;
        this.aggregate
          .update(props, new Date(this.now() + STALE_AFTER_MS))
          .catch(() => {});
        this.states.set(chatId, {
          phase: props.phase,
          lastUpdateAt: this.now(),
        });
        return;
      }
      if (this.aggregate === undefined && this.cb.selectedChatId() === chatId) {
        try {
          this.aggregate = this.driver.start(props, activityUrl(chatId));
          this.aggregateFor = chatId;
          this.states.set(chatId, {
            phase: props.phase,
            lastUpdateAt: this.now(),
          });
        } catch {
          /* Live Activities unavailable entirely */
        }
      }
      return;
    }
    this.handles.set(chatId, handle);
    this.tokenSubs.set(
      chatId,
      handle.addPushTokenListener(e =>
        this.cb.onPushToken(chatId, e.pushToken),
      ),
    );
    this.states.set(chatId, {
      phase: props.phase,
      lastUpdateAt: this.now(),
    });
  }

  private end(
    chatId: string,
    outcome: 'completed' | 'errored' | 'immediate',
  ): void {
    const handle =
      this.handles.get(chatId) ??
      (this.aggregateFor === chatId ? this.aggregate : undefined);
    if (handle === undefined) {
      this.states.delete(chatId);
      return;
    }
    const policy =
      outcome === 'completed'
        ? this.driver.after(new Date(this.now() + COMPLETED_DISMISS_MS))
        : outcome === 'immediate'
        ? 'immediate'
        : 'default';
    handle.end(policy).catch(() => {});
    this.tokenSubs.get(chatId)?.remove();
    this.tokenSubs.delete(chatId);
    this.handles.delete(chatId);
    if (this.aggregateFor === chatId) {
      this.aggregate = undefined;
      this.aggregateFor = undefined;
    }
    this.states.delete(chatId);
    this.cb.onUnregister(chatId);
  }

  /** Relaunch recovery: rebind to OS-surviving instances. */
  recover(chatIds: readonly string[]): void {
    for (const inst of this.driver.getInstances()) {
      const id = inst.getId();
      const known = [...this.handles.entries()].find(
        ([, h]) => h.getId() === id,
      );
      if (known === undefined && chatIds.length === 1) {
        this.handles.set(chatIds[0], inst);
      }
    }
  }

  endAll(): void {
    for (const chatId of [...this.states.keys()]) {
      this.end(chatId, 'immediate');
    }
  }
}
