// Expo Go preview shim — not used in production builds.
// react-native-nitro-websockets has no JS fallback; in Go the app picks
// `rnWsFactory` (RN's built-in WebSocket) before ever requiring this module.
// If something still imports it, fail loudly instead of crashing the bundle.

export class NitroWebSocket {
  constructor() {
    throw new Error(
      'react-native-nitro-websockets is not available in Expo Go',
    );
  }
}
