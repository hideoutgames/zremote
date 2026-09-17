// Nitro spec for the in-repo `react-native-loro` module — a bridge over
// loro-swift 1.13.3 (pin per apps/ios Zeron Package.resolved, FFI rev
// 625f3e69). Everything crosses as ArrayBuffer + JSON strings so the spec
// stays a flat HybridObject (no nested hybrid types).
//
// IMPLEMENTED-BUT-UNVERIFIED: written on Windows, first compiled on a Mac
// (see docs/NATIVE_MODULES.md).

import type { HybridObject } from 'react-native-nitro-modules';

export interface LoroDoc extends HybridObject<{ ios: 'swift' }> {
  /** Remote update or snapshot bytes; throws on malformed input. */
  importBytes(bytes: ArrayBuffer): void;
  /** Updates since `vv` (undefined = full oplog from the empty vv). */
  exportUpdatesFrom(vv: ArrayBuffer | undefined): ArrayBuffer;
  exportSnapshot(): ArrayBuffer;
  /** oplog version vector, encoded (VersionVector.encode). */
  oplogVersionEncoded(): ArrayBuffer;
  /** containsFrontier: decode-fail and decoded-empty both → false. */
  oplogIncludes(vv: ArrayBuffer): boolean;
  /** Deep value (containers resolved) as a JSON string. */
  toJSONString(): string;
  /** Fires after each local commit; returns a subscription id. */
  subscribeLocalUpdates(cb: (update: ArrayBuffer) => void): number;
  unsubscribe(id: number): void;
  commit(): void;

  /** list.pushContainer(new LoroMap()) + LoroValue.fromJSON per field. */
  pushMapToList(listId: string, fieldsJson: string): void;
  setListMapField(
    listId: string,
    index: number,
    key: string,
    valueJson: string,
  ): void;

  /** LoroMovableList ops for the `queue` container family. */
  movableListLength(listId: string): number;
  movableListPushMap(listId: string, fieldsJson: string): void;
  movableListDelete(listId: string, index: number, len: number): void;
  movableListMove(listId: string, from: number, to: number): void;
  movableListSetField(
    listId: string,
    index: number,
    key: string,
    valueJson: string,
  ): void;
  movableListDeleteField(listId: string, index: number, key: string): void;
}
