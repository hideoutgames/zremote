// Soft-keyboard first-responder for the hidden terminal TextInput.
// TrueSheet presentation and list gestures often steal focus after the
// first attempt; retry until onFocus or the delay list is exhausted.
// Key-bar taps re-assert focus even while already focused, and keep the
// retry list armed so a blur that lands after onPress still recovers.

export const TERMINAL_FOCUS_RETRY_MS = [50, 200, 400] as const;

export type Focusable = { focus: () => void };

export function createTerminalFocus(getTarget: () => Focusable | null): {
  focusInput: () => void;
  onFocus: () => void;
  onBlur: () => void;
  isFocused: () => boolean;
  dispose: () => void;
} {
  let focused = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clear = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const attempt = (i: number): void => {
    if (!focused) getTarget()?.focus();
    const delay = TERMINAL_FOCUS_RETRY_MS[i];
    if (delay === undefined) return;
    timer = setTimeout(() => attempt(i + 1), delay);
  };

  return {
    focusInput: () => {
      clear();
      if (focused) {
        getTarget()?.focus();
        timer = setTimeout(() => attempt(0), 0);
        return;
      }
      attempt(0);
    },
    onFocus: () => {
      focused = true;
      clear();
    },
    onBlur: () => {
      focused = false;
    },
    isFocused: () => focused,
    dispose: clear,
  };
}
