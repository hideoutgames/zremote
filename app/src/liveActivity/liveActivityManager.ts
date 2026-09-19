// Live Activity manager — pure planning + a thin driver seam.
//
// `planActivity` decides what to do on each observed session change; the
// `LiveActivityDriver` interface hides expo-widgets so the policy is fully
// unit-testable. Runtime wiring lives in `bindLiveActivities.ts`.
//
// Policy (docs/NATIVE_MODULES.md):
//  - start when a session enters `working`/`awaitingInput`/`planReady`
//    (dedupe by chatId)
//  - `working` updates throttled to one per 5s; awaitingInput/errored/
//    planReady/completed are immediate
//  - completed → end after(now+30min); errored → end default; user archive →
//    'immediate'
//  - staleDate on updates: now+120s (mirrors the edge's stale-date)
//  - if the OS refuses a start (limit), leftovers pack into ONE overflow
//    activity whose expanded view lists those agents

import type {
  SessionActivityPhase,
  SessionActivityProps,
} from './SessionActivity';

export const WORKING_UPDATE_MIN_MS = 5_000;
export const STALE_AFTER_MS = 120_000;
export const COMPLETED_DISMISS_MS = 30 * 60_000;
export const OVERFLOW_CHAT_ID = '__overflow__';

const START_PHASES: ReadonlySet<SessionActivityPhase> = new Set([
  'working',
  'awaitingInput',
  'planReady',
]);

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
    if (START_PHASES.has(next.phase)) {
      return { kind: 'start', props: next };
    }
    return { kind: 'none' };
  }
  if (next.phase === 'completed' || next.phase === 'errored') {
    return { kind: 'end', outcome: next.phase };
  }
  if (prev.phase === next.phase && next.phase === 'working') {
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
  /** Currently-selected chat (unused for overflow packing). */
  selectedChatId(): string | undefined;
};

const activityUrl = (chatId: string): string => `zeron://session/${chatId}`;

export class LiveActivityManager {
  private states = new Map<string, ActivityState>();
  private handles = new Map<string, LiveActivityHandle>();
  private tokenSubs = new Map<string, { remove(): void }>();
  private overflowHandle: LiveActivityHandle | undefined;
  private overflowItems = new Map<string, SessionActivityProps>();

  constructor(
    private driver: LiveActivityDriver,
    private cb: LiveActivityCallbacks,
    private now: () => number = () => Date.now(),
  ) {}

  /** Chat ids currently packed into the overflow activity. */
  overflowChatIds(): string[] {
    return [...this.overflowItems.keys()];
  }

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
        const h = this.handles.get(chatId);
        if (h !== undefined) {
          h.update(action.props, new Date(this.now() + STALE_AFTER_MS)).catch(
            () => {},
          );
        } else if (this.overflowItems.has(chatId)) {
          this.overflowItems.set(chatId, action.props);
          this.syncOverflow();
        }
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
      this.packOverflow(chatId, props);
      return;
    }
    this.overflowItems.delete(chatId);
    this.syncOverflow();
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

  private packOverflow(chatId: string, props: SessionActivityProps): void {
    this.overflowItems.set(chatId, props);
    this.states.set(chatId, {
      phase: props.phase,
      lastUpdateAt: this.now(),
    });
    if (this.overflowHandle === undefined) {
      try {
        this.overflowHandle = this.driver.start(
          this.buildOverflowProps(),
          undefined,
          new Date(this.now() + STALE_AFTER_MS),
        );
      } catch {
        /* Live Activities unavailable entirely */
      }
      return;
    }
    this.syncOverflow();
  }

  private buildOverflowProps(): SessionActivityProps {
    const items = [...this.overflowItems.values()];
    const n = items.length;
    return {
      chatId: OVERFLOW_CHAT_ID,
      title: n === 1 ? items[0]?.title ?? 'Agents' : `${n} agents`,
      overflowTitles: items.map(i => i.title),
      phase: items.some(i => i.phase === 'awaitingInput')
        ? 'awaitingInput'
        : items.some(i => i.phase === 'planReady')
        ? 'planReady'
        : 'working',
      phaseLabel: n === 1 ? items[0]?.phaseLabel ?? 'working' : `${n} running`,
      startedAt: items[0]?.startedAt ?? this.now() / 1000,
      showContext: true,
      accentColor: '#FFFFFF',
      glyph: 'rectangle.stack',
    };
  }

  private syncOverflow(): void {
    if (this.overflowItems.size === 0) {
      if (this.overflowHandle !== undefined) {
        this.overflowHandle.end('immediate').catch(() => {});
        this.overflowHandle = undefined;
      }
      return;
    }
    this.overflowHandle
      ?.update(this.buildOverflowProps(), new Date(this.now() + STALE_AFTER_MS))
      .catch(() => {});
  }

  private end(
    chatId: string,
    outcome: 'completed' | 'errored' | 'immediate',
  ): void {
    if (this.overflowItems.has(chatId)) {
      this.overflowItems.delete(chatId);
      this.states.delete(chatId);
      this.syncOverflow();
      return;
    }
    const handle = this.handles.get(chatId);
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
    if (this.overflowHandle !== undefined) {
      this.overflowHandle.end('immediate').catch(() => {});
      this.overflowHandle = undefined;
    }
    this.overflowItems.clear();
  }
}
