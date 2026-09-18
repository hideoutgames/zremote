// Shared session-tool sheet chrome: 75% first detent, grabber, no close
// button. View details, Sub-agents, History, Files, and Terminal all use
// this so they dismiss the same way (swipe / grabber / Android back).

import React, { type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { TrueSheet } from '@lodev09/react-native-true-sheet';
import { useTheme } from '../theme';

export const SESSION_SHEET_DETENTS: (number | 'auto')[] = [0.75, 1];

export function SessionSheet({
  title,
  onDismiss,
  children,
  fill = false,
}: {
  title?: string;
  onDismiss: () => void;
  children: ReactNode;
  /** Fill the detent so Files / Terminal can layout a flex body. */
  fill?: boolean;
}) {
  const theme = useTheme();

  return (
    <TrueSheet
      detents={SESSION_SHEET_DETENTS}
      initialDetentIndex={0}
      onDidDismiss={onDismiss}
      grabber
      backgroundColor={theme.background}
    >
      <View testID="session-sheet" style={fill ? styles.fill : undefined}>
        {title !== undefined ? (
          <Text
            style={[styles.title, { color: theme.text }]}
            accessibilityRole="header"
          >
            {title}
          </Text>
        ) : null}
        {fill ? <View style={styles.fill}>{children}</View> : children}
      </View>
    </TrueSheet>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  title: {
    fontSize: 28,
    fontWeight: '700',
    textAlign: 'center',
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 12,
  },
});
