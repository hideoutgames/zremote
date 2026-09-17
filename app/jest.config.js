module.exports = {
  // RN 0.86's `preset: 'react-native'` is a shim that requires the optional
  // peer `@react-native/jest-preset`; src/zeron is pure TypeScript, so the
  // default babel-jest transform (babel.config.js) is sufficient.
  testPathIgnorePatterns: ['node_modules', 'ios', 'android'],
};
