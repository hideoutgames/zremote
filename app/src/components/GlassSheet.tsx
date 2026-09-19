// Shared Liquid Glass sheet chrome used by Thought process and the queue
// panel. TrueSheet hosts the sheet; Glass frosts the body.

import React, { useRef, useState, type ReactNode } from 'react';
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

export function GlassSheet({
  title,
  onDismiss,
  children,
  maxContentHeight,
}: {
  title?: string;
  onDismiss: () => void;
  children: ReactNode;
  maxContentHeight?: number;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const keyboardHeight = useKeyboardState(s => s.height);
  const sheet = useRef<TrueSheet>(null);
  const [expanded, setExpanded] = useState(false);

  const cap = Math.max(
    240,
    Math.round(
      (maxContentHeight ?? windowHeight - insets.top) - (keyboardHeight || 0),
    ),
  );

  return (
    <TrueSheet
      ref={sheet}
      detents={['auto', 1]}
      initialDetentIndex={0}
      onDidDismiss={onDismiss}
      onDetentChange={event => setExpanded(event.nativeEvent.index >= 1)}
      maxContentHeight={cap}
      backgroundColor="transparent"
      grabber
    >
      <Glass
        style={[
          styles.body,
          expanded ? styles.bodyExpanded : undefined,
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
        <View style={expanded ? styles.bodyFill : undefined}>{children}</View>
        <MenuDismissShield />
      </Glass>
    </TrueSheet>
  );
}

const CLOSE = 32;

const styles = StyleSheet.create({
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
