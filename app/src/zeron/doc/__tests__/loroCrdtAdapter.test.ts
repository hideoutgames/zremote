// Ported from zeron@853872d — adapter conformance for the LoroDocPort
// contract (containsFrontier semantics per SessionStore / chat2_host).

import { LoroDoc, LoroList, LoroMap, LoroText } from 'loro-crdt';
import { LoroCrdtAdapter } from '../loroCrdtAdapter';

describe('LoroCrdtAdapter', () => {
  it('exports updates, imports into a peer, and reads deep values', () => {
    const a = new LoroCrdtAdapter();
    a.pushMapToList('commands', { id: 'x', nested: { a: 1 } });
    a.commit();
    const update = a.exportUpdatesFrom(null);
    expect(update.length).toBeGreaterThan(0);

    const b = new LoroCrdtAdapter();
    b.import(update);
    expect(b.toJSON()).toEqual({ commands: [{ id: 'x', nested: { a: 1 } }] });
  });

  it('exportUpdatesFrom(vv) exports only the delta past the vector', () => {
    const a = new LoroCrdtAdapter();
    a.pushMapToList('items', { n: 1 });
    a.commit();
    const vv = a.oplogVersionEncoded();
    a.pushMapToList('items', { n: 2 });
    a.commit();
    const delta = a.exportUpdatesFrom(vv);

    const b = new LoroCrdtAdapter();
    b.import(a.exportUpdatesFrom(null));
    b.import(delta);
    expect(b.toJSON()).toEqual({ items: [{ n: 1 }, { n: 2 }] });
  });

  it('oplogIncludes: contained frontier ⇒ true; empty/garbage ⇒ false', () => {
    const a = new LoroCrdtAdapter();
    a.pushMapToList('items', { n: 1 });
    a.commit();
    const vv = a.oplogVersionEncoded();

    const b = new LoroCrdtAdapter();
    // Not yet imported: the doc does NOT include a's frontier.
    expect(b.oplogIncludes(vv)).toBe(false);
    b.import(a.exportUpdatesFrom(null));
    expect(b.oplogIncludes(vv)).toBe(true);

    // Vacuous claim and undecodable bytes both read as not-contained.
    expect(b.oplogIncludes(new LoroDoc().oplogVersion().encode())).toBe(false);
    expect(b.oplogIncludes(new Uint8Array(0))).toBe(false);
    expect(b.oplogIncludes(new Uint8Array([0xff, 0xff, 0xff]))).toBe(false);
  });

  it('subscribeLocalUpdates fires after commit with importable bytes', () => {
    const a = new LoroCrdtAdapter();
    const updates: Uint8Array[] = [];
    const unsub = a.subscribeLocalUpdates(u => updates.push(u));
    a.pushMapToList('items', { n: 1 });
    a.commit();
    unsub();
    a.pushMapToList('items', { n: 2 });
    a.commit();
    expect(updates).toHaveLength(1);
    const b = new LoroCrdtAdapter();
    b.import(updates[0]);
    expect(b.toJSON()).toEqual({ items: [{ n: 1 }] });
  });

  it('movableList supports push/delete/move/setField', () => {
    const a = new LoroCrdtAdapter();
    const list = a.movableList('queue');
    list.pushMap({ id: 'q1', text: 'one' });
    list.pushMap({ id: 'q2', text: 'two' });
    list.pushMap({ id: 'q3', text: 'three' });
    a.commit();
    expect(list.length()).toBe(3);
    list.move(0, 2);
    a.commit();
    list.setField(0, 'text', 'two!');
    a.commit();
    list.delete(1, 1);
    a.commit();
    const rows = (a.toJSON() as { queue: { id: string; text: string }[] })
      .queue;
    // move(0,2) → [q2,q3,q1]; delete(1,1) drops q3.
    expect(rows.map(r => r.id)).toEqual(['q2', 'q1']);
    expect(rows[0].text).toBe('two!');
  });

  it('setListMapField updates an existing list map (cancel path)', () => {
    const a = new LoroCrdtAdapter();
    a.pushMapToList('commands', { id: 'c1', status: 'pending' });
    a.commit();
    a.setListMapField('commands', 0, 'status', 'cancelled');
    a.commit();
    expect(a.toJSON()).toEqual({
      commands: [{ id: 'c1', status: 'cancelled' }],
    });
  });

  it('import throws on malformed bytes', () => {
    const a = new LoroCrdtAdapter();
    expect(() => a.import(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toThrow();
  });

  it('LoroText bodies survive a round-trip as plain strings in toJSON', () => {
    // The host writes streaming text into LoroText containers; the deep
    // value must read them back as strings.
    const host = new LoroDoc();
    const messages = host.getList('messages');
    const msg = messages.pushContainer(new LoroMap());
    msg.set('id', 'm1');
    const parts = msg.setContainer('parts', new LoroList());
    const part = parts.pushContainer(new LoroMap());
    part.set('id', 'p1');
    part.set('kind', 'text');
    const body = part.setContainer('text', new LoroText());
    body.insert(0, 'streaming…');
    host.commit();
    const snapshot = host.export({ mode: 'snapshot' });
    const b = new LoroCrdtAdapter();
    b.import(snapshot);
    const projected = b.toJSON() as {
      messages: { id: string; parts: { text: string }[] }[];
    };
    expect(projected.messages[0].id).toBe('m1');
    expect(projected.messages[0].parts[0].text).toBe('streaming…');
  });
});
