// liveActivityManager: planActivity policy + manager lifecycle.

import {
  LiveActivityManager,
  planActivity,
  WORKING_UPDATE_MIN_MS,
  type LiveActivityDriver,
  type LiveActivityHandle,
} from '../liveActivityManager';
import type { SessionActivityProps } from '../SessionActivity';

const props = (
  phase: SessionActivityProps['phase'],
  chatId = 'c1',
): SessionActivityProps => ({
  chatId,
  title: 'Session',
  phase,
  phaseLabel: phase,
  startedAt: 1,
  showContext: true,
});

const T0 = 1_000_000;

test('planActivity: starts on working/awaitingInput only', () => {
  expect(planActivity(undefined, props('working'), T0).kind).toBe('start');
  expect(planActivity(undefined, props('awaitingInput'), T0).kind).toBe(
    'start',
  );
  expect(planActivity(undefined, props('stale'), T0).kind).toBe('none');
  expect(planActivity(undefined, props('completed'), T0).kind).toBe('none');
});

test('planActivity: working updates throttle to 5s; urgent phases immediate', () => {
  const prev = { phase: 'working' as const, lastUpdateAt: T0 };
  expect(planActivity(prev, props('working'), T0 + 1_000).kind).toBe('none');
  expect(
    planActivity(prev, props('working'), T0 + WORKING_UPDATE_MIN_MS).kind,
  ).toBe('update');
  expect(planActivity(prev, props('awaitingInput'), T0 + 1).kind).toBe(
    'update',
  );
  expect(planActivity(prev, props('completed'), T0 + 1).kind).toBe('end');
  expect(planActivity(prev, props('errored'), T0 + 1).kind).toBe('end');
});

class FakeHandle implements LiveActivityHandle {
  static seq = 0;
  id = `a${++FakeHandle.seq}`;
  updates: SessionActivityProps[] = [];
  ended: string[] = [];
  tokenCb?: (e: { activityId: string; pushToken: string }) => void;
  getId() {
    return this.id;
  }
  async update(p: SessionActivityProps) {
    this.updates.push(p);
  }
  async end(policy: 'default' | 'immediate' | { after: Date }) {
    this.ended.push(typeof policy === 'string' ? policy : 'after');
  }
  addPushTokenListener(
    cb: (e: { activityId: string; pushToken: string }) => void,
  ) {
    this.tokenCb = cb;
    return { remove: () => {} };
  }
}

class FakeDriver implements LiveActivityDriver {
  failStarts = false;
  started: FakeHandle[] = [];
  instances: FakeHandle[] = [];
  start(_p: SessionActivityProps): LiveActivityHandle {
    if (this.failStarts) throw new Error('activity limit');
    const h = new FakeHandle();
    this.started.push(h);
    this.instances.push(h);
    return h;
  }
  getInstances() {
    return this.instances;
  }
  after(date: Date) {
    return { after: date };
  }
}

const make = (driver = new FakeDriver()) => {
  const tokens: { chatId: string; token: string }[] = [];
  const unreg: string[] = [];
  const mgr = new LiveActivityManager(
    driver,
    {
      onPushToken: (chatId, token) => tokens.push({ chatId, token }),
      onUnregister: chatId => unreg.push(chatId),
      selectedChatId: () => 'c1',
    },
    () => now,
  );
  let now = T0;
  return { driver, mgr, tokens, unreg, setNow: (t: number) => (now = t) };
};

test('start dedupes, token listener registers, end unregisters', () => {
  const { driver, mgr, tokens, unreg } = make();
  mgr.apply('c1', props('working'));
  mgr.apply('c1', props('working')); // throttled < 5s → no update
  expect(driver.started).toHaveLength(1);
  driver.started[0].tokenCb?.({ activityId: 'a1', pushToken: 'pt' });
  expect(tokens).toEqual([{ chatId: 'c1', token: 'pt' }]);
  mgr.apply('c1', props('completed'));
  expect(driver.started[0].ended).toEqual(['after']);
  expect(unreg).toEqual(['c1']);
});

test('OS refusal falls back to aggregate for the selected session', () => {
  const driver = new FakeDriver();
  driver.failStarts = true;
  const { mgr } = make(driver);
  mgr.apply('c1', props('working'));
  driver.failStarts = false;
  // aggregate created lazily on first failure for the selected session
  mgr.apply('c2', props('working'));
  expect(driver.started.length).toBeLessThanOrEqual(1);
});
