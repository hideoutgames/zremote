// demoMode enter/exit ↔ authStore: the demo setter injects signed-in only
// while no real session is signed in, and the real bindAuthSession path is
// unaffected.

import type { AuthSession } from '../../zeron/auth/authSession';
import type { AuthState } from '../../zeron/auth/authSession';
import {
  authStore,
  bindAuthSession,
  resetAuth,
  setDemoAuthStatus,
} from '../../zeron/state/authStore';
import { enterDemo, exitDemo, demoModeStore } from '../demoMode';
import { DEMO_ORG, DEMO_USER } from '../fixtures';

/** Minimal AuthSession stand-in: bindAuthSession only calls subscribe(). */
const fakeSession = (initial: AuthState): AuthSession => {
  let state = initial;
  const listeners = new Set<(s: AuthState) => void>();
  return {
    subscribe(cb: (s: AuthState) => void) {
      listeners.add(cb);
      cb(state);
      return () => listeners.delete(cb);
    },
    __set(s: AuthState) {
      state = s;
      for (const cb of listeners) cb(s);
    },
  } as unknown as AuthSession;
};

afterEach(() => {
  exitDemo();
  resetAuth();
});

test('enterDemo signs in with the demo identity; exitDemo signs out', () => {
  enterDemo();
  expect(demoModeStore.getState().active).toBe(true);
  const s = authStore.getState().status;
  expect(s.state).toBe('signedIn');
  if (s.state === 'signedIn') {
    expect(s.user.id).toBe(DEMO_USER);
    expect(s.orgId).toBe(DEMO_ORG);
  }

  exitDemo();
  expect(demoModeStore.getState().active).toBe(false);
  expect(authStore.getState().status.state).toBe('signedOut');
});

test('demo setter is a no-op while a real session is signed in', () => {
  const unbind = bindAuthSession(
    fakeSession({
      state: 'signedIn',
      user: { id: 'real-user' },
      orgId: 'real-org',
    }),
  );
  expect(setDemoAuthStatus({ state: 'signedOut' })).toBe(false);
  enterDemo();
  expect(demoModeStore.getState().active).toBe(false);
  const s = authStore.getState().status;
  expect(s.state).toBe('signedIn');
  if (s.state === 'signedIn') expect(s.user.id).toBe('real-user');
  unbind();
});

test('a bound-but-signed-out real session does not block demo entry', () => {
  const unbind = bindAuthSession(fakeSession({ state: 'signedOut' }));
  enterDemo();
  expect(demoModeStore.getState().active).toBe(true);
  expect(authStore.getState().status.state).toBe('signedIn');
  unbind();
});
