// KeyboardChatScrollView as FlashList's scroll component. Isolated so
// worklets stay out of SessionTranscriptList's memo cache.

import React, { forwardRef } from 'react';
import {
  KeyboardChatScrollView,
  type KeyboardChatScrollViewProps,
} from 'react-native-keyboard-controller';
import type { ScrollViewProps } from 'react-native';

export const TranscriptChatScrollView = forwardRef<
  React.ComponentRef<typeof KeyboardChatScrollView>,
  ScrollViewProps & KeyboardChatScrollViewProps
>(function TranscriptChatScrollViewInner(props, ref) {
  'use no memo';
  return (
    <KeyboardChatScrollView
      ref={ref}
      automaticallyAdjustContentInsets={false}
      contentInsetAdjustmentBehavior="never"
      {...props}
      applyWorkaroundForContentInsetHitTestBug
      keyboardLiftBehavior="whenAtEnd"
    />
  );
});
