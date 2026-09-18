// Expo Go preview shim — not used in production builds.
// Live Activities need ActivityKit — unavailable in Expo Go.
// `createLiveActivity` returns a factory whose `start` throws; the
// LiveActivityManager already catches driver.start failures.

const notInGo = (): never => {
  throw new Error('Live Activities are not available in Expo Go');
};

export const createLiveActivity = <P>(_name: string, _layout: unknown) => ({
  start: (_props: P, _url?: string, _staleDate?: Date): never => notInGo(),
  getInstances: (): [] => [],
});

export const addPushToStartTokenListener = (
  _cb: (token: string) => void,
): { remove(): void } => ({ remove: () => {} });

export const after = (date: Date): Date => date;

export default { createLiveActivity, addPushToStartTokenListener, after };
