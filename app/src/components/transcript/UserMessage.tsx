// User transcript row (message bubble): text bubble, attachment chips, and
// the "Show more" fold at ~400 chars / 5 lines like desktop.
// Message-row shape follows Agents Kit beui/message + prompt-kit/message
// (both MIT) — a plain bubble; no avatar chrome on this client.

import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Share } from 'react-native';
import * as ContextMenu from 'zeego/context-menu';
import Animated, {
  Easing,
  SlideInDown,
  useReducedMotion,
} from 'react-native-reanimated';
import type { MessageEntry } from '../../zeron/protocol/types';
import { Icon } from '../Icon';
import { useTheme } from '../../theme';
import { t } from '../../i18n/strings';

const FOLD_CHARS = 400;
const FOLD_LINES = 5;

const textOf = (entry: MessageEntry): string =>
  entry.parts
    .filter(
      (p): p is { kind: 'text'; id: string; text: string } => p.kind === 'text',
    )
    .map(p => p.text)
    .join('\n');

export const UserMessage = React.memo(function ({
  entry,
  chatId,
}: {
  entry: MessageEntry;
  chatId?: string;
}) {
  const theme = useTheme();
  const reduceMotion = useReducedMotion();
  const [expanded, setExpanded] = useState(false);
  const text = textOf(entry);
  const images = entry.parts.filter(p => p.kind === 'image');
  const foldable = text.length > FOLD_CHARS;
  const shown = expanded || !foldable ? text : `${text.slice(0, FOLD_CHARS)}…`;

  const menu = (
    <ContextMenu.Content>
      <ContextMenu.Item
        key="copy"
        onSelect={() => Clipboard.setStringAsync(text).catch(() => {})}
      >
        <ContextMenu.ItemTitle>{t('common.copyText')}</ContextMenu.ItemTitle>
      </ContextMenu.Item>
      <ContextMenu.Item
        key="share"
        onSelect={() => Share.share({ message: text }).catch(() => {})}
      >
        <ContextMenu.ItemTitle>{t('common.share')}</ContextMenu.ItemTitle>
      </ContextMenu.Item>
      {chatId !== undefined ? (
        <ContextMenu.Item
          key="link"
          onSelect={() =>
            Clipboard.setStringAsync(`zeron://session/${chatId}`).catch(
              () => {},
            )
          }
        >
          <ContextMenu.ItemTitle>{t('common.copyLink')}</ContextMenu.ItemTitle>
        </ContextMenu.Item>
      ) : null}
    </ContextMenu.Content>
  );
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger>
        <Animated.View
          style={styles.row}
          entering={
            reduceMotion
              ? undefined
              : SlideInDown.easing(Easing.out(Easing.exp)).duration(700)
          }
        >
          {images.length > 0 ? (
            <View style={styles.attachmentRow}>
              {images.map(p =>
                p.kind === 'image' ? (
                  <View
                    key={p.id}
                    style={[
                      styles.attachmentChip,
                      {
                        backgroundColor: theme.surface,
                        borderColor: theme.border,
                      },
                    ]}
                  >
                    <Icon name="photo" size={13} color={theme.textSecondary} />
                    <Text
                      style={[styles.attachmentName, { color: theme.text }]}
                      numberOfLines={1}
                    >
                      {p.name}
                    </Text>
                  </View>
                ) : null,
              )}
            </View>
          ) : null}
          {text !== '' ? (
            <View
              style={[
                styles.bubble,
                { backgroundColor: theme.userBubbleBackground },
              ]}
            >
              <Text
                style={[styles.text, { color: theme.userBubbleText }]}
                numberOfLines={expanded ? undefined : FOLD_LINES}
              >
                {shown}
              </Text>
              {foldable ? (
                <Pressable
                  onPress={() => setExpanded(e => !e)}
                  hitSlop={6}
                  accessibilityRole="button"
                  accessibilityLabel={
                    expanded ? t('session.showLess') : t('session.showMore')
                  }
                  accessibilityState={{ expanded }}
                >
                  <Text style={[styles.fold, { color: theme.accent }]}>
                    {expanded ? t('session.showLess') : t('session.showMore')}
                  </Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}
        </Animated.View>
      </ContextMenu.Trigger>
      {menu}
    </ContextMenu.Root>
  );
});

const styles = StyleSheet.create({
  row: {
    alignItems: 'flex-end',
    paddingHorizontal: 16,
    paddingVertical: 4,
  },
  attachmentRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: 6,
    maxWidth: '82%',
    marginBottom: 4,
  },
  attachmentChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 8,
    paddingVertical: 5,
    maxWidth: 180,
  },
  attachmentName: { fontSize: 12 },
  bubble: {
    maxWidth: '82%',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  text: { fontSize: 16, lineHeight: 21 },
  fold: { fontSize: 13, fontWeight: '500', marginTop: 4 },
});
