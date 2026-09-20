module.exports = {
  preset: 'react-native',
  setupFiles: ['@shopify/react-native-skia/jestSetup.js', './jest.setup.js'],
  testPathIgnorePatterns: ['node_modules', 'ios', 'android'],
  moduleNameMapper: {
    '^expo-symbols$': '<rootDir>/__mocks__/expo-symbols.js',
    // whisper.rn's package exports map has no '.' entry; jest-resolve
    // honours it, so point bare imports at the RN source entry instead.
    '^whisper\\.rn$': '<rootDir>/__mocks__/whisper.rn.js',
  },
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|react-native-safe-area-context|react-native-keyboard-controller|react-native-reanimated|react-native-worklets|@shopify/react-native-skia|react-freeze|sf-symbols-typescript)/)',
  ],
};
