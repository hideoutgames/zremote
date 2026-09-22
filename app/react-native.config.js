// Installed transitively as a react-native-sherpa-onnx peer, but the app
// only uses the ./stt subpath — nothing references this module's native
// code, so keep it out of autolinking.
module.exports = {
  dependencies: {
    '@kesha-antonov/react-native-background-downloader': {
      platforms: {
        android: null,
        ios: null,
      },
    },
  },
};
