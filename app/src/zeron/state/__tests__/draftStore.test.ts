// Draft persistence: debounced 300ms via the injected clock, account-scoped
// files, failed-send restore that never clobbers the live draft.

import {
  draftStore,
  bindDrafts,
  resetDrafts,
  setDraftText,
  restoreFailedSend,
} from '../draftStore';
import { draftsPath } from '../../native/docDisk';
import { FakeClock } from '../../transport/clock';
import { memDisk, flush } from '../../testing/memDisk';

describe('draftStore', () => {
  beforeEach(resetDrafts);

  it('persists drafts debounced to the account-scoped drafts.json', async () => {
    const { fs, disk } = memDisk();
    const clock = new FakeClock(1_000_000);
    await bindDrafts(disk, 'o1', 'u1', clock);

    setDraftText('c1', 'hello');
    setDraftText('c1', 'hello world');
    // Nothing written until the debounce fires.
    expect(fs.writes).toHaveLength(0);
    clock.advance(299);
    expect(fs.writes).toHaveLength(0);
    clock.advance(2);
    await flush();

    const path = draftsPath('/docs', 'o1', 'u1');
    const saved = JSON.parse(fs.files.get(path)!) as Record<
      string,
      { text: string }
    >;
    expect(saved.c1.text).toBe('hello world');
  });

  it('restores drafts on bind (survives session switches)', async () => {
    const { disk } = memDisk();
    const clock = new FakeClock(0);
    await bindDrafts(disk, 'o1', 'u1', clock);
    setDraftText('c1', 'draft A');
    clock.advance(400);
    await flush();

    resetDrafts();
    expect(draftStore.getState().byChat).toEqual({});

    const clock2 = new FakeClock(0);
    await bindDrafts(disk, 'o1', 'u1', clock2);
    expect(draftStore.getState().byChat.c1.text).toBe('draft A');
  });

  it('restoreFailedSend appends without clobbering the current draft', async () => {
    const { disk } = memDisk();
    await bindDrafts(disk, 'o1', 'u1', new FakeClock(0));

    restoreFailedSend('c1', 'failed text');
    expect(draftStore.getState().byChat.c1.text).toBe('failed text');

    setDraftText('c1', 'typed since');
    restoreFailedSend('c1', 'second failure');
    expect(draftStore.getState().byChat.c1.text).toBe(
      'typed since\n\nsecond failure',
    );
  });

  it('isolates drafts per account (separate files)', async () => {
    const { fs, disk } = memDisk();
    const clock = new FakeClock(0);

    await bindDrafts(disk, 'o1', 'alice', clock);
    setDraftText('c1', 'alice draft');
    clock.advance(400);
    await flush();

    await bindDrafts(disk, 'o2', 'bob', clock);
    expect(draftStore.getState().byChat.c1).toBeUndefined();
    setDraftText('c1', 'bob draft');
    clock.advance(400);
    await flush();

    const a = JSON.parse(fs.files.get(draftsPath('/docs', 'o1', 'alice'))!);
    const b = JSON.parse(fs.files.get(draftsPath('/docs', 'o2', 'bob'))!);
    expect(a.c1.text).toBe('alice draft');
    expect(b.c1.text).toBe('bob draft');
  });
});
