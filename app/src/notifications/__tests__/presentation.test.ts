import { chatIdFromData, shouldPresentBanner } from '../presentation';

test('hides only when active and viewing that thread', () => {
  expect(
    shouldPresentBanner({
      appState: 'active',
      selectedChatId: 'c1',
      notificationChatId: 'c1',
    }),
  ).toBe(false);
  expect(
    shouldPresentBanner({
      appState: 'active',
      selectedChatId: undefined,
      notificationChatId: 'c1',
    }),
  ).toBe(true);
  expect(
    shouldPresentBanner({
      appState: 'active',
      selectedChatId: 'c2',
      notificationChatId: 'c1',
    }),
  ).toBe(true);
  expect(
    shouldPresentBanner({
      appState: 'background',
      selectedChatId: 'c1',
      notificationChatId: 'c1',
    }),
  ).toBe(true);
  expect(
    shouldPresentBanner({
      appState: 'inactive',
      selectedChatId: 'c1',
      notificationChatId: 'c1',
    }),
  ).toBe(true);
});

test('chatIdFromData accepts edge ids only', () => {
  expect(chatIdFromData({ chatId: 'abc-1' })).toBe('abc-1');
  expect(chatIdFromData({ chatId: '../etc' })).toBeUndefined();
  expect(chatIdFromData({ url: 'zeron://session/abc-1' })).toBeUndefined();
  expect(chatIdFromData(null)).toBeUndefined();
  expect(chatIdFromData('c1')).toBeUndefined();
});
