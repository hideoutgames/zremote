import {
  menuClosed,
  menuOpenCount,
  menuOpened,
  resetMenuGate,
  subscribeMenuGate,
} from '../menuGate';

describe('menuGate', () => {
  afterEach(resetMenuGate);

  it('ref-counts open menus and notifies subscribers', () => {
    const seen: number[] = [];
    const unsub = subscribeMenuGate(() => seen.push(menuOpenCount()));
    menuOpened();
    menuOpened();
    menuClosed();
    menuClosed();
    menuClosed();
    expect(seen).toEqual([1, 2, 1, 0, 0]);
    unsub();
    menuOpened();
    expect(seen).toEqual([1, 2, 1, 0, 0]);
    expect(menuOpenCount()).toBe(1);
  });
});
