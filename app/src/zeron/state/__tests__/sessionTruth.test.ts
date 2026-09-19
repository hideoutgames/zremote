import { threadStatusLine } from '../sessionTruth';

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
