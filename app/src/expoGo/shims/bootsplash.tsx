// Expo Go preview shim — not used in production builds.
// react-native-bootsplash is not bundled in Expo Go and its module calls
// TurboModuleRegistry.getEnforcing at import time, so it must never reach the
// bundle. The app renders <BootSplash.HideOnDraw fade /> from App.tsx; the
// native splash isn't ours in Go anyway, so every API is a no-op.

const HideOnDraw = (_props: { fade?: boolean }): null => null;

const BootSplash = {
  hide: async (_opts?: { fade?: boolean }): Promise<void> => {},
  isVisible: async (): Promise<boolean> => false,
  useHideAnimation: undefined,
  HideOnDraw,
};

export default BootSplash;
