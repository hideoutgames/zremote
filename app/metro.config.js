// Learn more: https://docs.expo.dev/guides/customizing-metro
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// Expo Go preview mode (`EXPO_GO=1`, see scripts/start-go.js): unsupported
// native modules resolve to JS shims under src/expoGo/shims. Production
// resolution is untouched when the flag is unset.
if (process.env.EXPO_GO === '1') {
  const shim = name => path.resolve(__dirname, 'src', 'expoGo', 'shims', name);

  const GO_SHIMS = {
    'react-native-nitro-websockets': shim('nitroWebsockets.ts'),
    'react-native-nitro-modules': shim('nitroModules.ts'),
    'react-native-nitro-image': shim('nitroImage.tsx'),
    'react-native-nitro-web-image': shim('nitroWebImage.tsx'),
    'react-native-nitro-symbols': shim('nitroSymbols.tsx'),
    '@callstack/liquid-glass': shim('liquidGlass.tsx'),
    'react-native-enriched-markdown': shim('enrichedMarkdown.tsx'),
    '@lodev09/react-native-true-sheet': shim('trueSheet.tsx'),
    'zeego/dropdown-menu': shim('zeegoDropdown.ts'),
    'zeego/context-menu': shim('zeegoContext.ts'),
    'react-freeze': shim('reactFreeze.tsx'),
    'react-native-image-picker': shim('imagePicker.ts'),
    'react-native-bootsplash': shim('bootsplash.tsx'),
    'expo-widgets': shim('expoWidgets.ts'),
    '@expo/ui/swift-ui': shim('expoUiSwiftUi.tsx'),
    '@expo/ui/swift-ui/modifiers': shim('expoUiModifiers.ts'),
  };

  const upstream =
    typeof config.resolver?.resolveRequest === 'function'
      ? config.resolver.resolveRequest.bind(config.resolver)
      : undefined;
  config.resolver = {
    ...config.resolver,
    resolveRequest: (context, moduleName, platform) => {
      const target = GO_SHIMS[moduleName];
      if (target !== undefined) return { type: 'sourceFile', filePath: target };
      if (upstream !== undefined)
        return upstream(context, moduleName, platform);
      return context.resolveRequest(context, moduleName, platform);
    },
  };
}

module.exports = config;
