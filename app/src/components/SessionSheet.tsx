// Shared session-tool sheet chrome: 75% first detent, grabber, no close
// button. View details, Sub-agents, History, Files, and Terminal all use
// this so they dismiss the same way (swipe / grabber / Android back).
// TrueSheet needs a real detent height — `minHeight: '100%'` on the fill
// wrapper (same pattern as GlassSheet) so ScrollView / Terminal children
// do not collapse to 0 on iPhone.

import React, { type ReactNode } from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TrueSheet } from '@lodev09/react-native-true-sheet';
import { useKeyboardState } from 'react-native-keyboard-controller';
import { useTheme } from '../theme';
import { MenuDismissShield } from './menus/MenuDismissShield';

export const SESSION_SHEET_DETENTS: (number | 'auto')[] = [0.75, 1];

/** Native TrueSheet grabber is overlaid and does not take layout space. */
export const SESSION_SHEET_GRABBER_INSET = 24;

export function SessionSheet({
  title,
  onDismiss,
  children,
  fill = false,
  initialDetentIndex = 0,
}: {
  title?: string;
  onDismiss: () => void;
  children: ReactNode;
  /** Fill the detent so Files / Terminal can layout a flex body. */
  fill?: boolean;
  /** 0 = 75% (lists); 1 = full (Terminal). */
  initialDetentIndex?: number;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const keyboardHeight = useKeyboardState(s => s.height);
  const cap = Math.max(
    240,
    Math.round(windowHeight - insets.top - (keyboardHeight || 0)),
  );

  return (
    <TrueSheet
      detents={SESSION_SHEET_DETENTS}
      initialDetentIndex={initialDetentIndex}
      onDidDismiss={onDismiss}
      grabber
      maxContentHeight={cap}
      backgroundColor={theme.background}
    >
      <View
        testID="session-sheet"
        style={[
          fill ? styles.fill : undefined,
          {
            paddingTop: SESSION_SHEET_GRABBER_INSET,
            paddingBottom: insets.bottom,
          },
        ]}
      >
        {title !== undefined ? (
          <Text
            style={[styles.title, { color: theme.text }]}
            accessibilityRole="header"
          >
            {title}
          </Text>
        ) : null}
        {fill ? (
          <View testID="session-sheet-body" style={styles.body}>
            {children}
          </View>
        ) : (
          children
        )}
        <MenuDismissShield />
      </View>
    </TrueSheet>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, minHeight: '100%' },
  body: { flex: 1, minHeight: 0 },
  title: {
    fontSize: 17,
    fontWeight: '600',
    textAlign: 'center',
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 10,
  },
});
