// Compact Home↔Session pager transition. pager-view v8 on iOS is a SwiftUI
// TabView: setPage updates selection (and fires onPageSelected) at animation
// start, so Freeze/compose teardown must wait out the slide.

export const HOME_PAGE = 0;
export const SESSION_PAGE = 1;

/** SwiftUI default page slide is ~350ms; hold past that so Freeze cannot
 *  blank the session while onPageSelected has already flipped to Home. */
export const PAGER_SLIDE_MS = 400;

export const shouldFreezeSession = (
  isIdle: boolean,
  holdSession: boolean,
  activePage: number,
): boolean => isIdle && !holdSession && activePage !== SESSION_PAGE;
