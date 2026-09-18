// Auth state mirror: reflects the AuthSession state machine (signedOut /
// needsOrganization / signedIn) for views. `bindAuthSession` subscribes to
// the session's events.

import { createStore, useStore } from 'zustand';
import type { AuthSession, AuthState } from '../auth/authSession';

export interface AuthStoreState {
  status: AuthState;
  session?: AuthSession;
}

export const authStore = createStore<AuthStoreState>(() => ({
  status: { state: 'signedOut' },
}));

let unbind: (() => void) | undefined;

export const bindAuthSession = (session: AuthSession): (() => void) => {
  unbind?.();
  authStore.setState({ session });
  unbind = session.subscribe(status => {
    authStore.setState({ status, session });
  });
  return unbind;
};

/** Demo mode only: inject a status without an AuthSession. No-op while a
 * real session is bound AND signed in, so demo entry can never clobber a
 * live real-auth session (the AuthSession object itself is bound from app
 * start even while signed out — that alone must not block demo entry). */
export const setDemoAuthStatus = (status: AuthState): boolean => {
  const s = authStore.getState();
  if (s.session !== undefined && s.status.state === 'signedIn') return false;
  authStore.setState({ status });
  return true;
};

export const resetAuth = (): void => {
  unbind?.();
  unbind = undefined;
  authStore.setState({ status: { state: 'signedOut' }, session: undefined });
};

export const useAuthStatus = (): AuthState =>
  useStore(authStore, s => s.status);
