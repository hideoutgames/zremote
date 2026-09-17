// Ported from zeron@853872d — the `LoroDocPort` interface defined by
// docs/COMPATIBILITY.md ("Loro on device"): the ~15 doc operations the
// client needs, implemented by `loro-crdt` under Node/Jest and by a Nitro
// module over loro-swift on iOS. No loro imports here — this file is the
// device-independent contract.

export type LoroJsonValue =
  | null
  | boolean
  | number
  | string
  | LoroJsonValue[]
  | { [k: string]: LoroJsonValue };

export interface MovableListHandle {
  length(): number;
  pushMap(fields: Record<string, LoroJsonValue>): void;
  delete(index: number, len: number): void;
  move(from: number, to: number): void;
  /** Set one field on the map at `index` (LoroMap.insert on the container). */
  setField(index: number, key: string, value: LoroJsonValue): void;
  /** Delete one field on the map at `index` (LoroMap.delete). */
  deleteField?(index: number, key: string): void;
}

export interface LoroDocPort {
  /** Remote update or snapshot; throws on malformed bytes. */
  import(bytes: Uint8Array): void;
  /** null = full oplog from the empty version vector. */
  exportUpdatesFrom(vv: Uint8Array | null): Uint8Array;
  exportSnapshot(): Uint8Array;
  oplogVersionEncoded(): Uint8Array;
  /** containsFrontier semantics: decode fails ⇒ false; a decoded EMPTY vv ⇒
   * false (the vacuous-claim rule — "Add Tweets" incident). */
  oplogIncludes(encodedVv: Uint8Array): boolean;
  /** Deep value (containers resolved to plain JSON). */
  toJSON(): unknown;
  /** Fires after each local commit with the update bytes. */
  subscribeLocalUpdates(cb: (update: Uint8Array) => void): () => void;
  commit(): void;
  /** `list.pushContainer(new LoroMap())` then set each field (nested plain
   * JSON values allowed — LoroValue.fromJSON semantics). */
  pushMapToList(listId: string, fields: Record<string, LoroJsonValue>): void;
  /** Set one field on the map at `index` inside a plain list. */
  setListMapField(
    listId: string,
    index: number,
    key: string,
    value: LoroJsonValue,
  ): void;
  /** The `queue` container family: LoroMovableList ops. */
  movableList(listId: string): MovableListHandle;
  free?(): void;
}
