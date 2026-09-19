import { formatWorkingElapsed } from '../workingElapsed';

describe('formatWorkingElapsed', () => {
  const now = 1_800_000_000_000;

  it('formats compact s / m / unbounded h', () => {
    expect(formatWorkingElapsed(now, now)).toBe('0s');
    expect(formatWorkingElapsed(now - 58_000, now)).toBe('58s');
    expect(formatWorkingElapsed(now - 34 * 60_000, now)).toBe('34m');
    expect(formatWorkingElapsed(now - 12 * 3_600_000, now)).toBe('12h');
    expect(formatWorkingElapsed(now - 47 * 3_600_000, now)).toBe('47h');
    expect(formatWorkingElapsed(now - 138 * 3_600_000, now)).toBe('138h');
  });

  it('floors to the current unit and never uses days', () => {
    expect(formatWorkingElapsed(now - 59_999, now)).toBe('59s');
    expect(formatWorkingElapsed(now - 60_000, now)).toBe('1m');
    expect(formatWorkingElapsed(now - 3_599_999, now)).toBe('59m');
    expect(formatWorkingElapsed(now - 3_600_000, now)).toBe('1h');
    expect(formatWorkingElapsed(now - 25 * 3_600_000, now)).toBe('25h');
  });
});
