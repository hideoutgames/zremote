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

export const resetAuth = (): void => {
  unbind?.();
  unbind = undefined;
  authStore.setState({ status: { state: 'signedOut' }, session: undefined });
};

export const useAuthStatus = (): AuthState =>
  useStore(authStore, s => s.status);
