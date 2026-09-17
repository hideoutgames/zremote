// react-native-loro adapter: ArrayBuffer↔Uint8Array + JSON plumbing against
// a fake hybrid object (the native side is Mac-verified).

import { nativeLoroDoc } from '../src/index';
import type { LoroDoc } from '../src/LoroDoc.nitro';

const fakeDoc = () => {
  const calls: unknown[][] = [];
  const doc: LoroDoc = {
    importBytes: b => calls.push(['import', b]),
    exportUpdatesFrom: vv => {
      calls.push(['exportUpdatesFrom', vv]);
      return new Uint8Array([1, 2]).buffer;
    },
    exportSnapshot: () => new Uint8Array([3]).buffer,
    oplogVersionEncoded: () => new Uint8Array([4]).buffer,
    oplogIncludes: () => true,
    toJSONString: () => '{"a":1}',
    subscribeLocalUpdates: cb => {
      cb(new Uint8Array([9]).buffer);
      return 7;
    },
    unsubscribe: id => calls.push(['unsub', id]),
    commit: () => calls.push(['commit']),
    pushMapToList: (id, j) => calls.push(['pushMap', id, j]),
    setListMapField: (id, i, k, j) => calls.push(['setField', id, i, k, j]),
    movableListLength: () => 3,
    movableListPushMap: (id, j) => calls.push(['mpush', id, j]),
    movableListDelete: (id, i, l) => calls.push(['mdel', id, i, l]),
    movableListMove: (id, f, t) => calls.push(['mmove', id, f, t]),
    movableListSetField: (id, i, k, j) => calls.push(['mset', id, i, k, j]),
    movableListDeleteField: (id, i, k) => calls.push(['mdelf', id, i, k]),
  } as unknown as LoroDoc;
  return { doc, calls };
};

test('bytes cross as ArrayBuffer, JSON fields serialize', () => {
  const { doc, calls } = fakeDoc();
  const port = nativeLoroDoc(doc);
  port.import(new Uint8Array([5, 6]));
  expect((calls[0][1] as ArrayBuffer).byteLength).toBe(2);
  expect(port.exportUpdatesFrom(null)).toEqual(new Uint8Array([1, 2]));
  port.pushMapToList('entries', { kind: 'msg', n: 1 });
  expect(calls.at(-1)).toEqual(['pushMap', 'entries', '{"kind":"msg","n":1}']);
  const list = port.movableList('queue');
  list.pushMap({ text: 'hi' });
  list.move(0, 2);
  list.setField(1, 'done', true);
  list.deleteField(1, 'x');
  expect(calls.slice(-4)).toEqual([
    ['mpush', 'queue', '{"text":"hi"}'],
    ['mmove', 'queue', 0, 2],
    ['mset', 'queue', 1, 'done', 'true'],
    ['mdelf', 'queue', 1, 'x'],
  ]);
  expect(list.length()).toBe(3);
});

test('subscription callback converts + unsub forwards the id', () => {
  const { doc, calls } = fakeDoc();
  const port = nativeLoroDoc(doc);
  const updates: Uint8Array[] = [];
  const off = port.subscribeLocalUpdates(u => updates.push(u));
  expect(updates[0]).toEqual(new Uint8Array([9]));
  off();
  expect(calls).toContainEqual(['unsub', 7]);
});
