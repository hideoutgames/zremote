// Offline queue sidecar: immediate persist while the host is down, never
// written for online enqueues, dropped when the live queue no longer has
// the id (sent / steered / removed).

import {
  addLocalQueued,
  bindQueuedLocal,
  displayedQueue,
  localQueuedFor,
  reconcileLocalQueued,
  removeLocalQueued,
  resetQueuedLocal,
} from '../queuedLocalStore';
import { queuedLocalPath } from '../../native/docDisk';
import { memDisk, flush } from '../../testing/memDisk';

describe('queuedLocalStore', () => {
  beforeEach(resetQueuedLocal);

  it('persists a row immediately (no debounce)', async () => {
    const { fs, disk } = memDisk();
    await bindQueuedLocal(disk, 'o1', 'u1');
    await addLocalQueued('c1', {
      id: 'q1',
      text: 'hold',
      issuedBy: 'phone',
      issuedAt: 1,
    });
    await flush();
    const path = queuedLocalPath('/docs', 'o1', 'u1');
    const saved = JSON.parse(fs.files.get(path)!) as Record<
      string,
      { id: string; text: string }[]
    >;
    expect(saved.c1).toEqual([
      expect.objectContaining({ id: 'q1', text: 'hold' }),
    ]);
  });

  it('restores rows on bind after a reset', async () => {
    const { disk } = memDisk();
    await bindQueuedLocal(disk, 'o1', 'u1');
    await addLocalQueued('c1', {
      id: 'q1',
      text: 'hold',
      issuedBy: 'phone',
      issuedAt: 1,
    });
    resetQueuedLocal();
    expect(localQueuedFor('c1')).toEqual([]);
    await bindQueuedLocal(disk, 'o1', 'u1');
    expect(localQueuedFor('c1').map(q => q.id)).toEqual(['q1']);
  });

  it('removeLocalQueued drops the id from memory and disk', async () => {
    const { fs, disk } = memDisk();
    await bindQueuedLocal(disk, 'o1', 'u1');
    await addLocalQueued('c1', {
      id: 'q1',
      text: 'a',
      issuedBy: 'phone',
      issuedAt: 1,
    });
    await addLocalQueued('c1', {
      id: 'q2',
      text: 'b',
      issuedBy: 'phone',
      issuedAt: 2,
    });
    await removeLocalQueued('c1', 'q1');
    await flush();
    expect(localQueuedFor('c1').map(q => q.id)).toEqual(['q2']);
    const path = queuedLocalPath('/docs', 'o1', 'u1');
    const saved = JSON.parse(fs.files.get(path)!) as Record<
      string,
      { id: string }[]
    >;
    expect(saved.c1.map(q => q.id)).toEqual(['q2']);
  });

  it('reconcile drops ids that left the live queue and keeps the rest', async () => {
    const { disk } = memDisk();
    await bindQueuedLocal(disk, 'o1', 'u1');
    await addLocalQueued('c1', {
      id: 'keep',
      text: 'k',
      issuedBy: 'phone',
      issuedAt: 1,
    });
    await addLocalQueued('c1', {
      id: 'gone',
      text: 'g',
      issuedBy: 'phone',
      issuedAt: 2,
    });
    await reconcileLocalQueued('c1', new Set(['keep']));
    expect(localQueuedFor('c1').map(q => q.id)).toEqual(['keep']);
  });

  it('displayedQueue appends sidecar-only rows after live rows', () => {
    addLocalQueued('c1', {
      id: 'local',
      text: 'parked',
      issuedBy: 'phone',
      issuedAt: 1,
    });
    const live = [
      { id: 'host', text: 'synced', issuedBy: 'phone', issuedAt: 0 },
    ];
    expect(displayedQueue('c1', live).map(q => q.id)).toEqual([
      'host',
      'local',
    ]);
    expect(
      displayedQueue('c1', [
        { id: 'local', text: 'parked', issuedBy: 'phone', issuedAt: 1 },
      ]).map(q => q.id),
    ).toEqual(['local']);
  });
});
