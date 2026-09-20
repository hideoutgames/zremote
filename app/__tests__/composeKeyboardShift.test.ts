import {
  COMPOSE_KEYBOARD_GAP,
  composeKeyboardShift,
  composerKeyboardStickyOffset,
} from '../src/navigation/composeKeyboardShift';

test('composeKeyboardShift is zero when the keyboard is down', () => {
  expect(
    composeKeyboardShift({
      windowHeight: 800,
      composerHeight: 200,
      keyboardHeight: 0,
    }),
  ).toBe(0);
});

test('composeKeyboardShift stays put when center already clears the keyboard', () => {
  // Centered 200pt composer sits at y=300–500 in an 800pt window. A 200pt
  // keyboard covers y=600–800, so no overlap even with the 8pt gap.
  expect(
    composeKeyboardShift({
      windowHeight: 800,
      composerHeight: 200,
      keyboardHeight: 200,
    }),
  ).toBe(0);
});

test('composeKeyboardShift lifts only the overlapping amount', () => {
  // Composer bottom at 500; keyboard top at 500. Gap 8 → lift 8.
  expect(
    composeKeyboardShift({
      windowHeight: 800,
      composerHeight: 200,
      keyboardHeight: 300,
    }),
  ).toBe(-COMPOSE_KEYBOARD_GAP);
  // Keyboard top at 400; overlap = 500 + 8 - 400 = 108.
  expect(
    composeKeyboardShift({
      windowHeight: 800,
      composerHeight: 200,
      keyboardHeight: 400,
    }),
  ).toBe(-(100 + COMPOSE_KEYBOARD_GAP));
});

test('composeKeyboardShift is a worklet-safe export', () => {
  expect(typeof composeKeyboardShift).toBe('function');
  expect(
    composeKeyboardShift({
      windowHeight: 800,
      composerHeight: 200,
      keyboardHeight: 0,
    }),
  ).toBe(0);
});

test('composerKeyboardStickyOffset eats the home inset while open', () => {
  expect(composerKeyboardStickyOffset(34)).toEqual({
    closed: 0,
    opened: 34,
  });
  expect(composerKeyboardStickyOffset(0)).toEqual({
    closed: 0,
    opened: 0,
  });
});
