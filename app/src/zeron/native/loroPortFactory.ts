// `createLoroDoc` factory for the app: hands a fresh `LoroDocPort` backed by
// the in-repo Nitro module `react-native-loro` (loro-swift on iOS). The module
// is a Stage-6 stub on Windows — calling this throws until the native build
// exists. Node/Jest uses `doc/loroCrdtAdapter.ts` (loro-crdt WASM) instead.

import { createNativeLoroDoc } from '../../../modules/react-native-loro';
import type { LoroDocPort } from '../doc/loroPort';

export const createLoroDoc = (): LoroDocPort => createNativeLoroDoc();
