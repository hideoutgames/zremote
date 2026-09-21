import React, { useEffect, useRef } from 'react';
import { menuClosed, menuOpened } from './menuGate';

/** Hold the dismiss shield after will-close so the outside tap cannot click through. */
export const MENU_DISMISS_HOLD_MS = 100;

type OpenChangeProps = {
  onOpenChange?: (open: boolean) => void;
  onOpenWillChange?: (willOpen: boolean) => void;
};

export function gateRoot<P extends OpenChangeProps>(
  Root: React.ComponentType<P>,
): React.ComponentType<P> {
  const GatedRoot = (props: P) => {
    const { onOpenChange, onOpenWillChange } = props;
    const openRef = useRef(false);
    const holdTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
      undefined,
    );
    const setOpen = (open: boolean) => {
      if (open === openRef.current) return;
      openRef.current = open;
      if (open) menuOpened();
      else menuClosed();
    };
    const clearHold = () => {
      if (holdTimer.current === undefined) return;
      clearTimeout(holdTimer.current);
      holdTimer.current = undefined;
    };
    useEffect(
      () => () => {
        if (holdTimer.current !== undefined) {
          clearTimeout(holdTimer.current);
          holdTimer.current = undefined;
        }
        if (!openRef.current) return;
        openRef.current = false;
        menuClosed();
      },
      [],
    );
    return React.createElement(Root, {
      ...props,
      onOpenWillChange: (willOpen: boolean) => {
        if (willOpen) {
          clearHold();
          setOpen(true);
        } else {
          clearHold();
          holdTimer.current = setTimeout(() => {
            holdTimer.current = undefined;
            setOpen(false);
          }, MENU_DISMISS_HOLD_MS);
        }
        onOpenWillChange?.(willOpen);
      },
      onOpenChange: (open: boolean) => {
        clearHold();
        setOpen(open);
        onOpenChange?.(open);
      },
    } as P);
  };
  GatedRoot.displayName = `Gated(${
    Root.displayName ?? Root.name ?? 'MenuRoot'
  })`;
  return GatedRoot;
}
