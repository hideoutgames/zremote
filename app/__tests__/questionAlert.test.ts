import {
  shouldLocalQuestionBanner,
  shouldNotifyOpenQuestion,
} from '../src/notifications/questionAlert';

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

test('open-question notify fires for a new tool question on another thread', () => {
  expect(
    shouldNotifyOpenQuestion({
      baseline: false,
      alreadyNotified: false,
      questionId: 'tc1',
      prevQuestionId: undefined,
      kind: 'tool',
      appState: 'active',
      selectedChatId: 'c2',
      chatId: 'c1',
      leavingForeground: false,
    }),
  ).toBe(true);
});

test('open-question notify stays quiet on the baseline and on the open thread', () => {
  expect(
    shouldNotifyOpenQuestion({
      baseline: true,
      alreadyNotified: false,
      questionId: 'tc1',
      prevQuestionId: undefined,
      kind: 'tool',
      appState: 'active',
      selectedChatId: 'c2',
      chatId: 'c1',
      leavingForeground: false,
    }),
  ).toBe(false);
  expect(
    shouldNotifyOpenQuestion({
      baseline: false,
      alreadyNotified: false,
      questionId: 'tc1',
      prevQuestionId: undefined,
      kind: 'tool',
      appState: 'active',
      selectedChatId: 'c1',
      chatId: 'c1',
      leavingForeground: false,
    }),
  ).toBe(false);
});

test('locking the phone delivers a question that was on screen', () => {
  expect(
    shouldNotifyOpenQuestion({
      baseline: false,
      alreadyNotified: false,
      questionId: 'tc1',
      prevQuestionId: 'tc1',
      kind: 'tool',
      appState: 'background',
      selectedChatId: 'c1',
      chatId: 'c1',
      leavingForeground: true,
    }),
  ).toBe(true);
  expect(
    shouldNotifyOpenQuestion({
      baseline: false,
      alreadyNotified: true,
      questionId: 'tc1',
      prevQuestionId: 'tc1',
      kind: 'tool',
      appState: 'background',
      selectedChatId: 'c1',
      chatId: 'c1',
      leavingForeground: true,
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
