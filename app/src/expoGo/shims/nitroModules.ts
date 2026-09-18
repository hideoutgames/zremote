// Expo Go preview shim — not used in production builds.
// Every Nitro hybrid object (react-native-loro, zeron-dictation, nitro-*) is
// created through NitroModules.createHybridObject — throwing here makes the
// callers' graceful fallbacks engage: AppRuntime's loro() probe catches this
// and selects relay session mode; dictation resolves to dictationUnavailable.

const unavailable = (name: string): never => {
  throw new Error(
    `react-native-nitro-modules is not available in Expo Go (${name})`,
  );
};

export const NitroModules = {
  createHybridObject<T>(name: string): T {
    return unavailable(name);
  },
  getHybridObjectConstructor(name: string): unknown {
    return unavailable(name);
  },
  hasHybridObject(_name: string): boolean {
    return false;
  },
};

export const HybridObject = {};
export default { NitroModules };
