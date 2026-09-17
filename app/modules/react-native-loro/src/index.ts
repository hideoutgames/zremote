// `createNativeLoroDoc` — the LoroDocPort adapter over the Nitro
// `LoroDoc` hybrid object. Everything crosses the bridge as ArrayBuffer +
// JSON strings; this file does the Uint8Array/JSON conversions.

import { NitroModules } from 'react-native-nitro-modules';
import type { LoroDoc as NativeLoroDoc } from './LoroDoc.nitro';
import type {
  LoroDocPort,
  MovableListHandle,
} from '../../../src/zeron/doc/loroPort';

const toBytes = (buf: ArrayBuffer): Uint8Array => new Uint8Array(buf);
const toBuffer = (bytes: Uint8Array): ArrayBuffer =>
  bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;

export const nativeLoroDoc = (doc: NativeLoroDoc): LoroDocPort => ({
  import: bytes => doc.importBytes(toBuffer(bytes)),
  exportUpdatesFrom: vv =>
    toBytes(doc.exportUpdatesFrom(vv === null ? undefined : toBuffer(vv))),
  exportSnapshot: () => toBytes(doc.exportSnapshot()),
  oplogVersionEncoded: () => toBytes(doc.oplogVersionEncoded()),
  oplogIncludes: vv => doc.oplogIncludes(toBuffer(vv)),
  toJSON: () => JSON.parse(doc.toJSONString()),
  subscribeLocalUpdates: cb => {
    const id = doc.subscribeLocalUpdates(update => cb(toBytes(update)));
    return () => doc.unsubscribe(id);
  },
  commit: () => doc.commit(),
  pushMapToList: (listId, fields) =>
    doc.pushMapToList(listId, JSON.stringify(fields)),
  setListMapField: (listId, index, key, value) =>
    doc.setListMapField(listId, index, key, JSON.stringify(value)),
  movableList: (listId): MovableListHandle => ({
    length: () => doc.movableListLength(listId),
    pushMap: fields => doc.movableListPushMap(listId, JSON.stringify(fields)),
    delete: (index, len) => doc.movableListDelete(listId, index, len),
    move: (from, to) => doc.movableListMove(listId, from, to),
    setField: (index, key, value) =>
      doc.movableListSetField(listId, index, key, JSON.stringify(value)),
    deleteField: (index, key) => doc.movableListDeleteField(listId, index, key),
  }),
});

/** The Nitro hybrid instance — throws if the module isn't linked. */
export const createNativeLoroDoc = (): LoroDocPort =>
  nativeLoroDoc(NitroModules.createHybridObject<NativeLoroDoc>('LoroDoc'));
