// Jest mocks for the native-only modules the UI imports. src/zeron is pure
// TypeScript and needs none of this; the mocks exist so react-test-renderer
// can mount screens/components without a device. Factories must require()
// inside — jest.mock disallows out-of-scope variable access.

jest.mock('react-native-worklets', () =>
  require('react-native-worklets/src/mock'),
);
jest.mock('react-native-reanimated', () => ({
  ...require('react-native-reanimated/mock'),
  // The upstream mock is missing this hook ("ADD ME IF NEEDED").
  useReducedMotion: () => false,
  // Upstream `makeMutable` is identity; shared values need `.value`.
  makeMutable: init => ({ value: init }),
}));
jest.mock('react-native-keyboard-controller', () => {
  const actual = require('react-native-keyboard-controller/jest');
  return {
    ...actual,
    useReanimatedKeyboardAnimation: () => ({
      height: { value: 0 },
      progress: { value: 0 },
    }),
  };
});
// The package's own mock exports the whole module as a default export.
jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

jest.mock('react-native-bootsplash', () => {
  const React = require('react');
  const { View } = require('react-native');
  const HideOnDraw = () =>
    React.createElement(View, { testID: 'bootsplash-hide-on-draw' });
  return {
    __esModule: true,
    default: {
      hide: jest.fn(() => Promise.resolve()),
      isVisible: jest.fn(() => Promise.resolve(false)),
      HideOnDraw,
    },
    HideOnDraw,
  };
});

jest.mock('@callstack/liquid-glass', () => ({
  isLiquidGlassSupported: false,
  LiquidGlassView: require('react-native').View,
  LiquidGlassContainerView: require('react-native').View,
}));

jest.mock('expo-blur', () => ({
  BlurView: require('react-native').View,
}));
jest.mock('expo-linear-gradient', () => ({
  LinearGradient: require('react-native').View,
}));
jest.mock('expo-image', () => ({
  Image: require('react-native').Image,
}));
jest.mock('@react-native-masked-view/masked-view', () => {
  const React = require('react');
  const { View } = require('react-native');
  const MaskedView = ({ children, maskElement, ...rest }) =>
    React.createElement(View, { ...rest, maskElement }, maskElement, children);
  MaskedView.default = MaskedView;
  return {
    __esModule: true,
    default: MaskedView,
  };
});

jest.mock('expo-glass-effect', () => ({
  GlassView: require('react-native').View,
  isLiquidGlassAvailable: () => false,
}));

jest.mock('expo-symbols', () => ({
  SymbolView: (props: object) =>
    require('react').createElement(require('react-native').View, props),
}));
jest.mock('react-native-nitro-image', () => ({
  NitroImage: (props: object) =>
    require('react').createElement(require('react-native').Image, props),
}));
jest.mock('react-native-nitro-websockets', () => ({
  NitroWebSocket: jest.fn(),
}));
jest.mock('react-native-nitro-modules', () => ({
  NitroModules: {
    // No native modules are linked under Jest — probing callers catch this.
    createHybridObject: () => {
      throw new Error('nitro hybrid object unavailable under Jest');
    },
  },
}));
jest.mock('@react-native-vector-icons/material-design-icons/static', () => ({
  MaterialDesignIcons: (props: object) =>
    require('react').createElement(require('react-native').Text, props),
  getImageSourceSync: jest.fn(),
}));

jest.mock('react-native-enriched-markdown', () => ({
  EnrichedMarkdownText: (props: object) =>
    require('react').createElement(require('react-native').Text, props),
}));

jest.mock('@lodev09/react-native-true-sheet', () => ({
  TrueSheet: ({
    children,
    ...props
  }: {
    children?: unknown,
    detents?: unknown,
  }) =>
    require('react').createElement(
      require('react-native').View,
      { testID: 'TrueSheet', ...props },
      children,
    ),
  dismissSheet: jest.fn(),
}));

const menuComponent =
  (name: string) => (props: { children?: unknown, [key: string]: unknown }) => {
    const { children, ...rest } = props;
    return require('react').createElement(
      require('react-native').View,
      { ...rest, testID: name },
      children,
    );
  };
const menuText = (props: object) =>
  require('react').createElement(require('react-native').Text, props);

jest.mock('zeego/dropdown-menu', () => ({
  Root: menuComponent('DropdownRoot'),
  Trigger: menuComponent('DropdownTrigger'),
  Content: menuComponent('DropdownContent'),
  Item: menuComponent('DropdownItem'),
  ItemTitle: menuText,
  ItemSubtitle: menuText,
  ItemIcon: () => null,
  Group: menuComponent('DropdownGroup'),
  Separator: () => null,
  CheckboxItem: menuComponent('DropdownCheckbox'),
  ItemIndicator: () => null,
  Sub: menuComponent('DropdownSub'),
  SubTrigger: menuComponent('DropdownSubTrigger'),
  SubContent: menuComponent('DropdownSubContent'),
  Arrow: () => null,
  Label: menuText,
}));
jest.mock('zeego/context-menu', () => ({
  Root: menuComponent('ContextRoot'),
  Trigger: menuComponent('ContextTrigger'),
  Content: menuComponent('ContextContent'),
  Item: menuComponent('ContextItem'),
  ItemTitle: menuText,
  ItemSubtitle: menuText,
  ItemIcon: () => null,
  Preview: () => null,
  Auxiliary: () => null,
  Separator: () => null,
  Group: menuComponent('ContextGroup'),
  Label: menuText,
}));

// @legendapp/list: render via FlatList (Home / Terminal).
jest.mock('@legendapp/list/react-native', () => {
  const RN = require('react-native');
  const ReactLib = require('react');
  const LegendList = ReactLib.forwardRef((props: object, ref: unknown) =>
    ReactLib.createElement(RN.FlatList, { ...props, ref }),
  );
  return { LegendList };
});
// @shopify/flash-list: v2 throws without New Architecture; tests render via
// FlatList and spy the imperative scroll methods used by the transcript.
jest.mock('@shopify/flash-list', () => {
  const RN = require('react-native');
  const ReactLib = require('react');
  const scrollToEnd = jest.fn();
  const scrollToIndex = jest.fn(() => Promise.resolve());
  const scrollToOffset = jest.fn();
  const FlashList = ReactLib.forwardRef((props: object, ref: unknown) => {
    ReactLib.useImperativeHandle(ref, () => ({
      scrollToEnd,
      scrollToIndex,
      scrollToOffset,
    }));
    return ReactLib.createElement(RN.FlatList, props);
  });
  return {
    FlashList,
    __scrollToEnd: scrollToEnd,
    __scrollToIndex: scrollToIndex,
    __scrollToOffset: scrollToOffset,
  };
});

jest.mock('react-freeze', () => ({
  Freeze: ({ children }: { children?: unknown }) => children,
}));

jest.mock('react-native-pager-view', () => {
  const ReactLib = require('react');
  const RN = require('react-native');
  const PagerView = ReactLib.forwardRef(
    (props: { children?: unknown }, ref: unknown) =>
      ReactLib.createElement(RN.View, { ...props, ref }),
  );
  return { __esModule: true, default: PagerView };
});

jest.mock('react-native-image-picker', () => ({
  launchImageLibrary: jest.fn(() => Promise.resolve({ didCancel: true })),
  launchCamera: jest.fn(() => Promise.resolve({ didCancel: true })),
}));

// Expo modules (loaded only by the native adapters — screens import them
// transitively via runtimeContext).
jest.mock('expo-constants', () => ({
  expoConfig: { extra: { edgeUrl: 'https://edge.test' } },
}));
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(() => Promise.resolve(null)),
  setItemAsync: jest.fn(() => Promise.resolve()),
  deleteItemAsync: jest.fn(() => Promise.resolve()),
  AFTER_FIRST_UNLOCK: 1,
}));
jest.mock('expo-crypto', () => ({
  getRandomBytes: jest.fn((n: number) => new Uint8Array(n)),
  getRandomBytesAsync: jest.fn((n: number) =>
    Promise.resolve(new Uint8Array(n)),
  ),
  digest: jest.fn(() => Promise.resolve(new Uint8Array(32))),
  randomUUID: jest.fn(() => '00000000-0000-4000-8000-000000000000'),
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
}));
jest.mock('expo-device', () => ({
  deviceName: 'Jest',
  modelName: 'Jest',
}));
jest.mock('expo-haptics', () => ({
  selectionAsync: jest.fn(() => Promise.resolve()),
  impactAsync: jest.fn(() => Promise.resolve()),
  notificationAsync: jest.fn(() => Promise.resolve()),
  prepareSelectionAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 0, Medium: 1, Heavy: 2 },
  NotificationFeedbackType: { Success: 0, Warning: 1, Error: 2 },
}));
jest.mock('expo-linking', () => ({
  getInitialURL: jest.fn(() => Promise.resolve(null)),
  addEventListener: jest.fn(() => ({ remove: jest.fn() })),
  parse: jest.fn(() => ({ path: '', queryParams: {} })),
}));
jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  addNotificationResponseReceivedListener: jest.fn(() => ({
    remove: jest.fn(),
  })),
  addPushTokenListener: jest.fn(() => ({ remove: jest.fn() })),
  getLastNotificationResponseAsync: jest.fn(() => Promise.resolve(null)),
  requestPermissionsAsync: jest.fn(() =>
    Promise.resolve({ status: 'granted' }),
  ),
  getDevicePushTokenAsync: jest.fn(() =>
    Promise.resolve({ type: 'ios', data: 'apns-test-token' }),
  ),
}));
jest.mock('expo-web-browser', () => ({
  openAuthSessionAsync: jest.fn(() => Promise.resolve({ type: 'cancel' })),
  openBrowserAsync: jest.fn(() => Promise.resolve({ type: 'cancel' })),
  maybeCompleteAuthSession: jest.fn(),
}));
jest.mock('expo-file-system', () => ({
  File: class {
    constructor(uri, name) {
      this.uri =
        typeof uri === 'string'
          ? name !== undefined
            ? `${uri.replace(/\/$/, '')}/${name}`
            : uri
          : uri?.uri !== undefined && name !== undefined
          ? `${String(uri.uri).replace(/\/$/, '')}/${name}`
          : uri?.uri ?? uri;
    }
    exists = false;
    base64() {
      return Promise.resolve('');
    }
    text() {
      return Promise.resolve('');
    }
    copy() {}
    delete() {}
    create() {}
  },
  Directory: class {
    constructor(base, name) {
      this.uri =
        typeof base === 'string'
          ? `${base.replace(/\/$/, '')}/${name ?? ''}`
          : `${String(base?.uri ?? 'file:///docs').replace(/\/$/, '')}/${
              name ?? ''
            }`;
      this.exists = false;
    }
    create() {}
    delete() {}
  },
  Paths: { document: { uri: 'file:///docs' }, cache: { uri: 'file:///cache' } },
}));
jest.mock('expo-file-system/legacy', () => ({
  createDownloadResumable: jest.fn(() => ({
    downloadAsync: jest.fn(() => Promise.resolve({})),
    resumeAsync: jest.fn(() => Promise.resolve({})),
    pauseAsync: jest.fn(() => Promise.resolve({})),
    savable: jest.fn(() => ({})),
  })),
}));
jest.mock('expo-document-picker', () => ({
  getDocumentAsync: jest.fn(() => Promise.resolve({ canceled: true })),
}));

jest.mock('expo-clipboard', () => ({
  setStringAsync: jest.fn(() => Promise.resolve()),
}));

// Voice engines are native-only; the voice resolvers probe these lazily and
// must never reach a real module under Jest.
jest.mock('expo-audio', () => ({
  AudioQuality: { MAX: 127 },
  IOSOutputFormat: { LINEARPCM: 'lpcm' },
  requestRecordingPermissionsAsync: jest.fn(() =>
    Promise.resolve({ granted: false }),
  ),
  setAudioModeAsync: jest.fn(() => Promise.resolve()),
  setIsAudioActiveAsync: jest.fn(() => Promise.resolve()),
}));
jest.mock('expo-audio/build/AudioModule', () => ({
  __esModule: true,
  default: { AudioRecorder: jest.fn() },
}));
jest.mock('llama.rn', () => ({
  initLlama: jest.fn(() => Promise.reject(new Error('jest'))),
}));
