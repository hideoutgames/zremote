module.exports = {
  preset: 'react-native',
  setupFiles: ['@shopify/react-native-skia/jestSetup.js', './jest.setup.js'],
  testPathIgnorePatterns: ['node_modules', 'ios', 'android'],
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|react-native-safe-area-context|react-native-keyboard-controller|react-native-reanimated|react-native-worklets|@shopify/react-native-skia|react-freeze|sf-symbols-typescript)/)',
  ],
};
