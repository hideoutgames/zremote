// Stage-6 placeholder for the in-repo Nitro module `react-native-loro`
// (docs/COMPATIBILITY.md "Loro on device"): an iOS bridge over the official
// `loro-swift 1.13.x` package exposing a `LoroDocPort`. The Swift/TS binding
// is written in a later stage and CANNOT be compiled or verified on Windows.
// Until then this stub exists so TypeScript resolution succeeds; calling it
// throws.

import type { LoroDocPort } from '../../../src/zeron/doc/loroPort';

export const createNativeLoroDoc = (): LoroDocPort => {
  throw new Error('react-native-loro native module not built');
};
