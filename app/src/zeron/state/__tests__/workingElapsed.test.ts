import {
  formatWorkedDuration,
  formatWorkedDurationRange,
  formatWorkingElapsed,
} from '../workingElapsed';

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

describe('formatWorkedDuration', () => {
  it('uses two units past a minute and never days', () => {
    expect(formatWorkedDuration(38)).toBe('38s');
    expect(formatWorkedDuration(14 * 60 + 38)).toBe('14m 38s');
    expect(formatWorkedDuration(2 * 3600 + 12 * 60)).toBe('2h 12m');
    expect(formatWorkedDuration(73 * 3600 + 12 * 60)).toBe('73h 12m');
  });

  it('keeps a zero remainder so the pattern stays two units', () => {
    expect(formatWorkedDuration(0)).toBe('0s');
    expect(formatWorkedDuration(59)).toBe('59s');
    expect(formatWorkedDuration(60)).toBe('1m 0s');
    expect(formatWorkedDuration(14 * 60)).toBe('14m 0s');
    expect(formatWorkedDuration(3599)).toBe('59m 59s');
    expect(formatWorkedDuration(3600)).toBe('1h 0m');
    expect(formatWorkedDuration(2 * 3600)).toBe('2h 0m');
  });

  it('floors fractional seconds and clamps negatives', () => {
    expect(formatWorkedDuration(38.9)).toBe('38s');
    expect(formatWorkedDuration(-12)).toBe('0s');
    expect(
      formatWorkedDurationRange(1_000, 1_000 + (14 * 60 + 38) * 1000),
    ).toBe('14m 38s');
  });
});
