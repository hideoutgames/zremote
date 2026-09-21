import {
  commitDayKey,
  formatRelativeShort,
  groupByCommitDay,
  parseCommitTime,
} from '../src/components/prTime';

test('formatRelativeShort uses s/m/h/d buckets', () => {
  const now = Date.parse('2026-09-19T12:00:00Z');
  expect(formatRelativeShort(now - 8_000, now)).toBe('8s');
  expect(formatRelativeShort(now - 16 * 60_000, now)).toBe('16m');
  expect(formatRelativeShort(now - 3 * 3_600_000, now)).toBe('3h');
  expect(formatRelativeShort(now - 2 * 86_400_000, now)).toBe('2d');
});

test('commitDayKey groups today and yesterday in local time', () => {
  const now = Date.parse('2026-09-19T18:00:00');
  const today = new Date(now);
  today.setHours(9, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  expect(commitDayKey(today.getTime(), now)).toBe('today');
  expect(commitDayKey(yesterday.getTime(), now)).toBe('yesterday');
});

test('groupByCommitDay keeps adjacent commits on the same day together', () => {
  const now = Date.parse('2026-09-19T18:00:00');
  const today = new Date(now);
  today.setHours(10, 0, 0, 0);
  const earlier = new Date(today);
  earlier.setHours(8, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const groups = groupByCommitDay(
    [
      { authoredAt: today.toISOString(), sha: 'a' },
      { authoredAt: earlier.toISOString(), sha: 'b' },
      { authoredAt: yesterday.toISOString(), sha: 'c' },
    ],
    now,
  );
  expect(groups.map(g => [g.key, g.items.map(i => i.sha)])).toEqual([
    ['today', ['a', 'b']],
    ['yesterday', ['c']],
  ]);
});

test('parseCommitTime returns 0 for garbage', () => {
  expect(parseCommitTime('nope')).toBe(0);
  expect(parseCommitTime('2026-09-19T10:00:00Z')).toBe(
    Date.parse('2026-09-19T10:00:00Z'),
  );
});
