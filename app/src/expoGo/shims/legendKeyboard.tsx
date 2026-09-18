// Expo Go preview shim — not used in production builds.
// @legendapp/list/keyboard wraps react-native-keyboard-controller's
// KeyboardChatScrollView. keyboard-controller IS bundled in Expo Go, but the
// chat-scroll surface is version-fragile; for the preview we degrade to the
// plain LegendList + the composer KeyboardStickyView shim.

import React, { useCallback } from 'react';
import { Keyboard, ScrollView } from 'react-native';
import { LegendList } from '@legendapp/list/react-native';

export const KeyboardAwareLegendList = React.forwardRef<
  React.ComponentRef<typeof LegendList>,
  React.ComponentProps<typeof LegendList>
>((props, ref) => <LegendList ref={ref} {...props} />);
KeyboardAwareLegendList.displayName = 'KeyboardAwareLegendList';

/** No-op in Go: the composer inset shim (KeyboardStickyView) handles it. */
export const useKeyboardChatComposerInset = (
  _listRef: unknown,
  _composerRef: unknown,
  _initialHeight?: number,
): void => {};

export const useKeyboardScrollToEnd = ({
  listRef,
}: {
  listRef?: React.RefObject<{
    scrollToEnd?: (o?: { animated?: boolean }) => void;
  } | null>;
} = {}) => {
  const scrollMessageToEnd = useCallback(
    (opts?: { animated?: boolean; closeKeyboard?: boolean }) => {
      listRef?.current?.scrollToEnd?.({ animated: opts?.animated });
      if (opts?.closeKeyboard === true) Keyboard.dismiss();
    },
    [listRef],
  );
  return { freeze: false, scrollMessageToEnd };
};

export { ScrollView as KeyboardChatScrollView };
