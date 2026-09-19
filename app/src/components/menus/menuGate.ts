// Ref-count of open Zeego (Liquid Glass) menus. The dismiss shield mounts
// while count > 0 so an outside tap cannot also hit the Pressable underneath.

type Listener = () => void;

const listeners = new Set<Listener>();
let openCount = 0;

const emit = (): void => {
  listeners.forEach(l => l());
};

export const menuOpened = (): void => {
  openCount += 1;
  emit();
};

export const menuClosed = (): void => {
  openCount = Math.max(0, openCount - 1);
  emit();
};

export const menuOpenCount = (): number => openCount;

export const subscribeMenuGate = (fn: Listener): (() => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};

export const resetMenuGate = (): void => {
  openCount = 0;
  emit();
};
