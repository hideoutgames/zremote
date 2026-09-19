import React, { useRef } from 'react';
import { menuClosed, menuOpened } from './menuGate';

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
    const setOpen = (open: boolean) => {
      if (open === openRef.current) return;
      openRef.current = open;
      if (open) menuOpened();
      else menuClosed();
    };
    return React.createElement(Root, {
      ...props,
      onOpenWillChange: (willOpen: boolean) => {
        if (willOpen) setOpen(true);
        onOpenWillChange?.(willOpen);
      },
      onOpenChange: (open: boolean) => {
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
