// Ported from zeron@853872d — Node/Jest implementation of `LoroDocPort`
// over the official `loro-crdt` WebAssembly build (the engine pins
// `loro = "1.13"`). See docs/COMPATIBILITY.md "Loro on device".

import { LoroDoc, LoroMap, VersionVector } from 'loro-crdt';
import type { LoroDocPort, LoroJsonValue, MovableListHandle } from './loroPort';

export class LoroCrdtAdapter implements LoroDocPort {
  readonly doc: LoroDoc;

  constructor(doc?: LoroDoc) {
    this.doc = doc ?? new LoroDoc();
  }

  import(bytes: Uint8Array): void {
    this.doc.import(bytes);
  }

  exportUpdatesFrom(vv: Uint8Array | null): Uint8Array {
    if (vv === null) return this.doc.export({ mode: 'update' });
    return this.doc.export({ mode: 'update', from: VersionVector.decode(vv) });
  }

  exportSnapshot(): Uint8Array {
    return this.doc.export({ mode: 'snapshot' });
  }

  oplogVersionEncoded(): Uint8Array {
    return this.doc.oplogVersion().encode();
  }

  /**
   * SessionStore `containsFrontier` / chat2_host `contains_frontier`:
   * - empty BYTES fail the decode ⇒ false (a present checkpoint with no
   *   frontier is unreadable provenance, never proof of emptiness);
   * - a decoded-but-EMPTY vv is the vacuous claim ⇒ false;
   * - otherwise `oplog_vv().includes_vv(other)` — here: the doc's oplog vv
   *   compares equal-or-greater against the candidate (0 = equal, 1 =
   *   greater; -1/undefined = missing or concurrent ⇒ not included).
   */
  oplogIncludes(encodedVv: Uint8Array): boolean {
    if (encodedVv.length === 0) return false;
    let vv: VersionVector;
    try {
      vv = VersionVector.decode(encodedVv);
    } catch {
      return false;
    }
    if (vv.toJSON().size === 0) return false;
    const cmp = this.doc.oplogVersion().compare(vv);
    return cmp === 0 || cmp === 1;
  }

  toJSON(): unknown {
    return this.doc.toJSON();
  }

  subscribeLocalUpdates(cb: (update: Uint8Array) => void): () => void {
    return this.doc.subscribeLocalUpdates(bytes => cb(bytes));
  }

  commit(): void {
    this.doc.commit();
  }

  pushMapToList(listId: string, fields: Record<string, LoroJsonValue>): void {
    const map = this.doc.getList(listId).pushContainer(new LoroMap());
    for (const [key, value] of Object.entries(fields)) {
      map.set(key, value);
    }
  }

  setListMapField(
    listId: string,
    index: number,
    key: string,
    value: LoroJsonValue,
  ): void {
    const list = this.doc.getList(listId);
    const item = list.get(index);
    if (item instanceof LoroMap) item.set(key, value);
  }

  movableList(listId: string): MovableListHandle {
    const list = this.doc.getMovableList(listId);
    return {
      length: () => list.length,
      pushMap: fields => {
        const map = list.pushContainer(new LoroMap());
        for (const [key, value] of Object.entries(fields)) {
          map.set(key, value);
        }
      },
      delete: (index, len) => list.delete(index, len),
      move: (from, to) => list.move(from, to),
      setField: (index, key, value) => {
        const item = list.get(index);
        if (item instanceof LoroMap) item.set(key, value);
      },
      deleteField: (index, key) => {
        const item = list.get(index);
        if (item instanceof LoroMap) item.delete(key);
      },
    };
  }
}
