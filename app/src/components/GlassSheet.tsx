// Shared Liquid Glass sheet chrome used by Thought process and the queue
// panel. TrueSheet hosts the sheet; Glass frosts the body. Default detent
// is half the screen; swipe up for full. The glass fills the detent so
// ScrollView children (thought process, queue, text preview) get a real
// height instead of collapsing.

import React, { useRef, type ReactNode } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TrueSheet } from '@lodev09/react-native-true-sheet';
import { useKeyboardState } from 'react-native-keyboard-controller';
import { Glass } from './Glass';
import { MenuDismissShield } from './menus/MenuDismissShield';
import { Icon } from './Icon';
import { useTheme } from '../theme';

export const GLASS_SHEET_DETENTS: (number | 'auto')[] = [0.5, 1];

export function GlassSheet({
  title,
  onDismiss,
  children,
  maxContentHeight,
  draggable = true,
}: {
  title?: string;
  onDismiss: () => void;
  children: ReactNode;
  maxContentHeight?: number;
  draggable?: boolean;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const keyboardHeight = useKeyboardState(s => s.height);
  const sheet = useRef<TrueSheet>(null);

  const cap = Math.max(
    240,
    Math.round(
      (maxContentHeight ?? windowHeight - insets.top) - (keyboardHeight || 0),
    ),
  );

  return (
    <TrueSheet
      ref={sheet}
      detents={GLASS_SHEET_DETENTS}
      initialDetentIndex={0}
      onDidDismiss={onDismiss}
      maxContentHeight={cap}
      backgroundColor="transparent"
      grabber
      draggable={draggable}
    >
      <View testID="glass-sheet" style={styles.fill}>
        <Glass
          testID="glass-sheet-body"
          style={[
            styles.body,
            styles.bodyExpanded,
            { paddingBottom: insets.bottom + 16 },
          ]}
        >
          <View style={styles.header}>
            <Pressable
              onPress={() => sheet.current?.dismiss()}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Close"
            >
              <View style={styles.closeButton}>
                <Icon name="xmark" size={15} color={theme.text} />
              </View>
            </Pressable>
            {title !== undefined ? (
              <Text style={[styles.title, { color: theme.text }]}>{title}</Text>
            ) : (
              <View style={styles.titleSpacer} />
            )}
            <View style={styles.closeButton} />
          </View>
          <View testID="glass-sheet-content" style={styles.bodyFill}>
            {children}
          </View>
          <MenuDismissShield />
        </Glass>
      </View>
    </TrueSheet>
  );
}

const CLOSE = 32;

const styles = StyleSheet.create({
  fill: { flex: 1, minHeight: '100%' },
  body: { borderRadius: 20, overflow: 'hidden' },
  bodyExpanded: { flex: 1, minHeight: '100%' },
  bodyFill: { flex: 1, minHeight: 0 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 10,
  },
  closeButton: {
    width: CLOSE,
    height: CLOSE,
    borderRadius: CLOSE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontSize: 17, fontWeight: '600' },
  titleSpacer: { flex: 1 },
});
