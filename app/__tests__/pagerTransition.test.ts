import {
  HOME_PAGE,
  PAGER_SLIDE_MS,
  SESSION_PAGE,
  shouldFreezeSession,
} from '../src/navigation/pagerTransition';

test('shouldFreezeSession blanks only after Home is idle and the hold is released', () => {
  expect(shouldFreezeSession(true, false, HOME_PAGE)).toBe(true);
  expect(shouldFreezeSession(true, true, HOME_PAGE)).toBe(false);
  expect(shouldFreezeSession(true, false, SESSION_PAGE)).toBe(false);
  expect(shouldFreezeSession(false, false, HOME_PAGE)).toBe(false);
  expect(shouldFreezeSession(true, true, SESSION_PAGE)).toBe(false);
});

test('PAGER_SLIDE_MS outlasts the SwiftUI page slide', () => {
  expect(PAGER_SLIDE_MS).toBeGreaterThan(350);
});
