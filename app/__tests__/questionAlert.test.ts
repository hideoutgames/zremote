import { shouldLocalQuestionBanner } from '../src/notifications/questionAlert';

test('local question banner: active + other thread + working→awaitingInput', () => {
  expect(
    shouldLocalQuestionBanner({
      prevStatus: 'working',
      status: 'awaitingInput',
      appState: 'active',
      selectedChatId: 'c2',
      chatId: 'c1',
    }),
  ).toBe(true);
});

test('local question banner hides on the selected thread', () => {
  expect(
    shouldLocalQuestionBanner({
      prevStatus: 'working',
      status: 'awaitingInput',
      appState: 'active',
      selectedChatId: 'c1',
      chatId: 'c1',
    }),
  ).toBe(false);
});

test('local question banner skips background (edge APNs covers lock screen)', () => {
  expect(
    shouldLocalQuestionBanner({
      prevStatus: 'working',
      status: 'awaitingInput',
      appState: 'background',
      selectedChatId: 'c2',
      chatId: 'c1',
    }),
  ).toBe(false);
});

test('local question banner ignores non-question flips', () => {
  expect(
    shouldLocalQuestionBanner({
      prevStatus: 'working',
      status: 'idle',
      appState: 'active',
      selectedChatId: 'c2',
      chatId: 'c1',
    }),
  ).toBe(false);
});
