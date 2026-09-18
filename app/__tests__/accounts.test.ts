// accounts.test.ts — usage-threshold reducer + reset-time formatting matching
// desktop (crates/ui/src/settings/accounts.rs L35-44, L100-114).

import {
  usageLevel,
  formatReset,
  USAGE_WARN_FRACTION,
  USAGE_CRITICAL_FRACTION,
} from '../src/zeron/accounts/accounts';

describe('usageLevel', () => {
  it('is normal below 80%', () => {
    expect(usageLevel(0)).toBe('normal');
    expect(usageLevel(USAGE_WARN_FRACTION - 0.01)).toBe('normal');
  });
  it('is warn from 80% to <95%', () => {
    expect(usageLevel(USAGE_WARN_FRACTION)).toBe('warn');
    expect(usageLevel(USAGE_CRITICAL_FRACTION - 0.01)).toBe('warn');
  });
  it('is critical at 95%+', () => {
    expect(usageLevel(USAGE_CRITICAL_FRACTION)).toBe('critical');
    expect(usageLevel(1)).toBe('critical');
  });
});

describe('formatReset', () => {
  const now = Date.parse('2026-01-15T12:00:00Z');
  it('returns undefined without a reset time', () => {
    expect(formatReset(undefined, now)).toBeUndefined();
  });
  it('uses a clock time within 22h', () => {
    const out = formatReset('2026-01-15T18:30:00Z', now);
    expect(out).toMatch(/^resets \d/);
  });
  it('uses a weekday within a week', () => {
    const out = formatReset('2026-01-18T12:00:00Z', now);
    expect(out).toMatch(/^resets \w{3}$/);
  });
  it('uses month+day beyond a week', () => {
    const out = formatReset('2026-02-01T12:00:00Z', now);
    expect(out).toMatch(/^resets \w{3} \d+$/);
  });
});
