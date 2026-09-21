import { formatMessageSentAt } from '../MessageCopyMenu';

test('formatMessageSentAt uses locale date and time', () => {
  const s = formatMessageSentAt(Date.UTC(2026, 8, 20, 20, 1), {
    locale: 'en-US',
    timeZone: 'UTC',
  });
  expect(s).toContain('Sep');
  expect(s).toContain('20');
  expect(s).toContain('2026');
  expect(s).toMatch(/8:01\sPM/);
});

test('formatMessageSentAt is empty for missing timestamps', () => {
  expect(formatMessageSentAt(0)).toBe('');
  expect(formatMessageSentAt(Number.NaN)).toBe('');
  expect(formatMessageSentAt(-1)).toBe('');
});
