// Tiny worklet-only child. Tracks grabber extra height onto the transcript
// KeyboardChatScrollView padding without a React commit per pan frame.

import { useAnimatedReaction, type SharedValue } from 'react-native-reanimated';
import {
  composerBaseHeightSV,
  composerExtraHeightSV,
} from './composerExtraHeight';

export function ComposerInsetBinding({
  extraContentPadding,
}: {
  extraContentPadding: SharedValue<number>;
}) {
  'use no memo';
  useAnimatedReaction(
    () => {
      const base = composerBaseHeightSV.value;
      if (base <= 0) return -1;
      return base + composerExtraHeightSV.value;
    },
    inset => {
      if (inset < 0) return;
      extraContentPadding.value = inset;
    },
  );
  return null;
}
