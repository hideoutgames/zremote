import {
  createTerminalFocus,
  TERMINAL_FOCUS_RETRY_MS,
} from '../src/zeron/terminal/focus';

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

test('focusInput retries until onFocus and then stops', () => {
  const focus = jest.fn();
  const ctl = createTerminalFocus(() => ({ focus }));
  ctl.focusInput();
  expect(focus).toHaveBeenCalledTimes(1);
  jest.advanceTimersByTime(TERMINAL_FOCUS_RETRY_MS[0]);
  expect(focus).toHaveBeenCalledTimes(2);
  ctl.onFocus();
  jest.advanceTimersByTime(1000);
  expect(focus).toHaveBeenCalledTimes(2);
  expect(ctl.isFocused()).toBe(true);
});

test('focusInput is a no-op while already focused', () => {
  const focus = jest.fn();
  const ctl = createTerminalFocus(() => ({ focus }));
  ctl.onFocus();
  ctl.focusInput();
  jest.advanceTimersByTime(1000);
  expect(focus).not.toHaveBeenCalled();
});

test('blur allows a later focusInput to retry', () => {
  const focus = jest.fn();
  const ctl = createTerminalFocus(() => ({ focus }));
  ctl.onFocus();
  ctl.onBlur();
  expect(ctl.isFocused()).toBe(false);
  ctl.focusInput();
  expect(focus).toHaveBeenCalledTimes(1);
});

test('dispose cancels pending retries', () => {
  const focus = jest.fn();
  const ctl = createTerminalFocus(() => ({ focus }));
  ctl.focusInput();
  ctl.dispose();
  jest.advanceTimersByTime(1000);
  expect(focus).toHaveBeenCalledTimes(1);
});

test('skips a missing target and still retries', () => {
  let target: { focus: () => void } | null = null;
  const focus = jest.fn();
  const ctl = createTerminalFocus(() => target);
  ctl.focusInput();
  expect(focus).not.toHaveBeenCalled();
  target = { focus };
  jest.advanceTimersByTime(TERMINAL_FOCUS_RETRY_MS[0]);
  expect(focus).toHaveBeenCalledTimes(1);
});
