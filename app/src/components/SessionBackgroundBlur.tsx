// Soft wallpaper blur behind the threads list and the existing-chat
// content column. Edges fade so the uncovered sides stay sharp. New
// thread compose does not mount this — that surface stays unblurred.

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { FadeBlur } from './FadeBlur';
import { useNewThreadComposerBackground } from '../zeron/state/uiPrefs';

const THREADS_INTENSITY = 42;
const CHAT_INTENSITY = 36;
const THREADS_EDGE = 0.08;
const CHAT_COLUMN_EDGE = 0.18;
const CHAT_VIGNETTE_EDGE = 0.16;

export function ThreadsBackgroundBlur() {
  const background = useNewThreadComposerBackground();
  if (background === undefined) return null;
  return (
    <View
      pointerEvents="none"
      testID="session-background-blur"
      style={styles.layer}
    >
      <FadeBlur
        fade="horizontal"
        fadeHold={THREADS_EDGE}
        intensity={THREADS_INTENSITY}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
}

export function ChatBackgroundBlur({
  contentMaxWidth,
}: {
  contentMaxWidth?: number;
}) {
  const background = useNewThreadComposerBackground();
  if (background === undefined) return null;
  const column = contentMaxWidth !== undefined;
  return (
    <View
      pointerEvents="none"
      testID="chat-background-blur"
      style={styles.layer}
    >
      <View
        style={
          column
            ? [styles.column, { maxWidth: contentMaxWidth }]
            : StyleSheet.absoluteFill
        }
      >
        <FadeBlur
          fade="horizontal"
          fadeHold={column ? CHAT_COLUMN_EDGE : CHAT_VIGNETTE_EDGE}
          intensity={CHAT_INTENSITY}
          style={StyleSheet.absoluteFill}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  layer: {
    ...StyleSheet.absoluteFill,
    zIndex: 0,
  },
  column: {
    flex: 1,
    width: '100%',
    alignSelf: 'center',
  },
});
