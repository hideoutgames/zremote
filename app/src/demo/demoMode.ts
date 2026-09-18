// Demo mode flag — NOT persisted (a reload returns to sign-in). enterDemo
// marks authStore signed-in with the demo identity so ZeronApp builds the
// simulated-edge runtime; exitDemo returns to signedOut and clears the
// synchronized stores.

import { createStore, useStore } from 'zustand';
import { authStore, setDemoAuthStatus } from '../zeron/state/authStore';
import { resetWorkspace } from '../zeron/state/workspaceStore';
import { resetSessionStores } from '../zeron/state/sessionStores';
import { resetCatalog } from '../zeron/state/catalogStore';
import { DEMO_ORG, DEMO_USER } from './fixtures';

interface DemoModeState {
  active: boolean;
}

export const demoModeStore = createStore<DemoModeState>(() => ({
  active: false,
}));

export const enterDemo = (): void => {
  const ok = setDemoAuthStatus({
    state: 'signedIn',
    user: { id: DEMO_USER },
    orgId: DEMO_ORG,
  });
  if (ok) demoModeStore.setState({ active: true });
};

export const exitDemo = (): void => {
  if (!demoModeStore.getState().active) return;
  demoModeStore.setState({ active: false });
  resetWorkspace();
  resetSessionStores();
  resetCatalog();
  // Only when the demo identity still holds the slot — a real session that
  // completed sign-in in the meantime owns the status now.
  const s = authStore.getState().status;
  if (s.state === 'signedIn' && s.orgId === DEMO_ORG)
    authStore.setState({ status: { state: 'signedOut' } });
};

export const useDemoMode = (): boolean =>
  useStore(demoModeStore, s => s.active);
