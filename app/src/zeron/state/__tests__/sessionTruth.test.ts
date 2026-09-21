import { threadStatusLine } from '../sessionTruth';
import { isPresenceFresh, PRESENCE_FRESH_MS } from '../../protocol/entities';

describe('threadStatusLine', () => {
  const pr = {
    tone: 'merged' as const,
    additions: 12,
    deletions: 3,
  };

  it('prefers a live working indicator over a PR', () => {
    expect(threadStatusLine('working', pr, '1h')).toEqual({ kind: 'working' });
  });

  it('prefers awaiting input over a PR', () => {
    expect(threadStatusLine('awaitingInput', pr, '1h')).toEqual({
      kind: 'awaitingInput',
    });
  });

  it('prefers an unseen error over a PR', () => {
    expect(threadStatusLine('errored', pr, '1h')).toEqual({ kind: 'errored' });
  });

  it('falls through to the PR when idle', () => {
    expect(threadStatusLine('idle', pr, '1h')).toEqual({
      kind: 'pr',
      tone: 'merged',
      additions: 12,
      deletions: 3,
    });
  });

  it('uses relative time when idle with no PR', () => {
    expect(threadStatusLine('completed', undefined, '3m')).toEqual({
      kind: 'time',
      label: '3m',
    });
  });
});

describe('isPresenceFresh', () => {
  const now = 100_000;

  it('treats a missing beat as not connected', () => {
    expect(isPresenceFresh(undefined, now)).toBe(false);
  });

  it('is fresh inside the 45s window and stale after', () => {
    expect(isPresenceFresh(now, now)).toBe(true);
    expect(isPresenceFresh(now - PRESENCE_FRESH_MS + 1, now)).toBe(true);
    expect(isPresenceFresh(now - PRESENCE_FRESH_MS, now)).toBe(false);
    expect(isPresenceFresh(now - PRESENCE_FRESH_MS - 1, now)).toBe(false);
  });
});
