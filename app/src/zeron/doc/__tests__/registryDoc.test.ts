// Ported from zeron@853872d apps/ios/ZeronTests/RegistryCoreTests.swift +
// RegistryDocTests.swift (offline writes, overlay, push/ack, seq handling,
// reseed, gcFloor, persistence).

import { RegistryDoc } from '../registryDoc';
import { encodeHlc, type Row } from '../../protocol/registryCore';

const DEV = 'dev-phone';

const row = (over: Partial<Row> = {}): Row => ({
  kind: 'chats',
  id: 'c1',
  seq: 1,
  deleted: false,
  fields: { title: 'from-server' },
  clocks: { title: encodeHlc(1000, 0, 'srv') },
  ...over,
});

describe('RegistryDoc offline writes + overlay', () => {
  it('local writes show through the overlay and push/ack cycles', () => {
    const doc = new RegistryDoc(DEV, () => 5000);
    doc.write('chats', 'c1', 'upsert', { title: 'mine', archived: false });

    // Overlay sees the row before any server truth exists.
    const seen = doc.overlayRow('chats', 'c1');
    expect(seen?.fields).toEqual({ title: 'mine', archived: false });
    expect(doc.overlayRows('chats').map(r => r.id)).toEqual(['c1']);
    expect(doc.rowExists('chats', 'c1')).toBe(true);
    expect(doc.helloCursor).toBe(0); // has history now — never nil again

    const batches = doc.takePushable();
    expect(batches).toHaveLength(1);
    expect(batches[0].ops[0]).toMatchObject({
      kind: 'chats',
      id: 'c1',
      op: 'upsert',
      set: { title: 'mine', archived: false },
    });
    expect(batches[0].ops[0].hlc).toMatch(/^\d{13}-\d{6}-dev-phone$/);
    // In-flight batches don't re-push until disconnect or ack.
    expect(doc.takePushable()).toHaveLength(0);
    doc.markDisconnected();
    expect(doc.takePushable()).toHaveLength(1);
    doc.ackBatch(batches[0].batch, 7);
    expect(doc.takePushable()).toHaveLength(0);
    expect(doc.pendingCount).toBe(0);
  });

  it('pending overlay merges over authoritative rows by HLC', () => {
    const doc = new RegistryDoc(DEV, () => 5000);
    doc.applyState(1, true, 0, [row()]);
    // A write whose HLC beats the server's field clock wins the overlay…
    doc.write('chats', 'c1', 'update', { title: 'local-newer' });
    expect(doc.overlayRow('chats', 'c1')?.fields.title).toBe('local-newer');
    // …and a stale clocked write would lose (simulate by crafting an old HLC).
    const stale = new RegistryDoc(DEV, () => 1);
    stale.applyState(1, true, 0, [row()]);
    stale.write('chats', 'c1', 'update', { title: 'stale' });
    expect(stale.overlayRow('chats', 'c1')?.fields.title).toBe('from-server');
  });

  it('deleteRows tombstones a batch atomically', () => {
    const doc = new RegistryDoc(DEV, () => 5000);
    doc.applyState(1, true, 0, [row(), row({ kind: 'sessions', id: 'c1' })]);
    doc.deleteRows([
      { kind: 'chats', id: 'c1' },
      { kind: 'sessions', id: 'c1' },
    ]);
    expect(doc.rowExists('chats', 'c1')).toBe(false);
    expect(doc.rowExists('sessions', 'c1')).toBe(false);
    expect(doc.takePushable()[0].ops.map(o => o.op)).toEqual([
      'delete',
      'delete',
    ]);
  });
});

describe('RegistryDoc server frames', () => {
  it('applyRows advances the cursor but holds across a seq gap', () => {
    const doc = new RegistryDoc(DEV, () => 0);
    expect(doc.applyRows(1, [row({ id: 'a' })])).toBe(true);
    expect(doc.cursor).toBe(1);
    // Gap: seq 3 arrives while cursor is 1 — rows apply, cursor holds.
    expect(doc.applyRows(3, [row({ id: 'b' })])).toBe(false);
    expect(doc.cursor).toBe(1);
    expect(doc.rowExists('chats', 'b')).toBe(true);
    // Backfill closes the window.
    expect(doc.applyRows(2, [])).toBe(true);
    expect(doc.applyRows(3, [])).toBe(true);
    expect(doc.cursor).toBe(3);
  });

  it('ack does not advance the cursor (peers may sit in between)', () => {
    const doc = new RegistryDoc(DEV, () => 5000);
    doc.write('chats', 'c1', 'upsert', { title: 'x' });
    const [b] = doc.takePushable();
    doc.ackBatch(b.batch, 9);
    expect(doc.cursor).toBe(0);
  });

  it('full state replaces authoritative rows; local-only rows re-seed', () => {
    const doc = new RegistryDoc(DEV, () => 5000);
    doc.applyState(5, true, 0, [row({ id: 'kept' }), row({ id: 'dropped' })]);
    const outcome = doc.applyState(6, true, 0, [row({ id: 'kept' })]);
    expect(outcome).toBe('reseeded');
    expect(doc.rowExists('chats', 'dropped')).toBe(true); // overlay re-seeds it
    const seed = doc.takePushable().flatMap(b => b.ops);
    const seedOp = seed.find(o => o.id === 'dropped');
    expect(seedOp?.op).toBe('upsert');
    // Original clocks preserved.
    expect(seedOp?.clocks?.title).toBe(encodeHlc(1000, 0, 'srv'));
  });

  it('server-behind-client (seq regression) keeps rows and re-seeds all', () => {
    const doc = new RegistryDoc(DEV, () => 5000);
    doc.applyState(10, true, 0, [row({ id: 'a' }), row({ id: 'b' })]);
    const outcome = doc.applyState(2, true, 0, [
      row({ id: 'fresh', fields: { title: 'new' } }),
    ]);
    expect(outcome).toBe('reseeded');
    expect(doc.cursor).toBe(2);
    // Server row merged in; local rows preserved and re-seeded.
    const seedIds = doc
      .takePushable()
      .flatMap(b => b.ops)
      .map(o => o.id)
      .sort();
    expect(seedIds).toEqual(['a', 'b']);
  });

  it('delta state applies rows without replacing', () => {
    const doc = new RegistryDoc(DEV, () => 5000);
    doc.applyState(5, true, 0, [row({ id: 'a' })]);
    expect(doc.applyState(6, false, 0, [row({ id: 'b' })])).toBe('delta');
    expect(doc.cursor).toBe(6);
    expect(doc.rowExists('chats', 'a')).toBe(true);
    expect(doc.rowExists('chats', 'b')).toBe(true);
  });

  it('tracks gcFloor', () => {
    const doc = new RegistryDoc(DEV, () => 0);
    doc.applyState(5, true, 3, []);
    expect(doc.gcFloorSeq).toBe(3);
  });
});

describe('RegistryDoc persistence', () => {
  it('serialize/deserialize round-trips rows, cursor, clock, pending', () => {
    const doc = new RegistryDoc(DEV, () => 5000);
    doc.applyState(5, true, 1, [row()]);
    doc.write('chats', 'c2', 'upsert', { title: 'pending' });
    const restored = RegistryDoc.deserialize(doc.serialize(), DEV);
    expect(restored.cursor).toBe(5);
    expect(restored.gcFloorSeq).toBe(1);
    expect(restored.overlayRow('chats', 'c1')?.fields.title).toBe(
      'from-server',
    );
    expect(restored.overlayRow('chats', 'c2')?.fields.title).toBe('pending');
    expect(restored.pendingCount).toBe(1);
    // inFlight is never persisted — restored batches are pushable.
    expect(restored.takePushable()).toHaveLength(1);
  });

  it('pre-epoch snapshots zero the cursor for one full resync', () => {
    const doc = new RegistryDoc(DEV, () => 5000);
    doc.applyState(5, true, 0, [row()]);
    const blob = JSON.parse(doc.serialize());
    delete blob.resyncEpoch; // simulate a pre-epoch snapshot
    const restored = RegistryDoc.deserialize(JSON.stringify(blob), DEV);
    expect(restored.cursor).toBe(0);
    expect(restored.rowExists('chats', 'c1')).toBe(true); // rows kept
  });

  it('rejects unknown snapshot versions', () => {
    expect(() => RegistryDoc.deserialize('{"v":99}', DEV)).toThrow(/version/);
  });

  it('fresh doc asks for full state (helloCursor undefined)', () => {
    expect(new RegistryDoc(DEV).helloCursor).toBeUndefined();
  });
});
