import { useCallback, useRef } from 'react';

/**
 * Long-pressing a Pressable inside a transcript context menu doesn't cancel
 * the press — the release still lands on the element, so e.g. the Thinking
 * row opens the Thought process sheet on top of the copy menu. Arm on
 * long-press, clear on the next press-in; the guarded onPress skips while
 * armed. One instance may serve several Pressables of the same component —
 * each press-in resets the flag.
 */
export const useSuppressAfterLongPress = (): {
  onPressIn: () => void;
  onLongPress: () => void;
  isSuppressed: () => boolean;
} => {
  const suppressed = useRef(false);
  const onPressIn = useCallback(() => {
    suppressed.current = false;
  }, []);
  const onLongPress = useCallback(() => {
    suppressed.current = true;
  }, []);
  const isSuppressed = useCallback(() => suppressed.current, []);
  return { onPressIn, onLongPress, isSuppressed };
};
