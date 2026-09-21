// whisper.rn is native-only and unresolvable under jest (its package
// exports map has no '.' entry). moduleNameMapper points bare imports here.
module.exports = {
  initWhisper: jest.fn(() =>
    Promise.reject(new Error('whisper unavailable under Jest')),
  ),
};
