// Shared Liquid Glass sheet chrome used by Thought process and the queue
// panel. TrueSheet hosts the sheet; Glass frosts the body.

import React, { useRef, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TrueSheet } from '@lodev09/react-native-true-sheet';
import { Glass } from './Glass';
import { Icon } from './Icon';
import { useTheme } from '../theme';

export function GlassSheet({
  title,
  onDismiss,
  children,
  maxContentHeight = 620,
}: {
  title?: string;
  onDismiss: () => void;
  children: ReactNode;
  maxContentHeight?: number;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const sheet = useRef<TrueSheet>(null);

  return (
    <TrueSheet
      ref={sheet}
      detents={['auto', 1]}
      initialDetentIndex={0}
      onDidDismiss={onDismiss}
      maxContentHeight={maxContentHeight}
      grabber
    >
      <Glass style={[styles.body, { paddingBottom: insets.bottom + 16 }]}>
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
        {children}
      </Glass>
    </TrueSheet>
  );
}

const CLOSE = 32;

const styles = StyleSheet.create({
  body: { borderRadius: 20, overflow: 'hidden' },
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
