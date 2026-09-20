// User transcript row (message bubble): text bubble, attachment chips, and
// the "Show more" fold at 1000 characters. Short messages are never
// ellipsized. Message-row shape follows Agents Kit beui/message +
// prompt-kit/message (both MIT) — a plain bubble; no avatar chrome.

import React, { useLayoutEffect, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import * as ContextMenu from '../menus/context-menu';
import Animated, {
  Easing,
  SlideInDown,
  useReducedMotion,
} from 'react-native-reanimated';
import type { MessageEntry } from '../../zeron/protocol/types';
import { Icon } from '../Icon';
import { useTheme } from '../../theme';
import { t } from '../../i18n/strings';
import { stripPlanPrefix } from '../planMode';
import { PlanBadge } from '../PlanBadge';
import { FrostedBubble } from './FrostedBubble';
import { messageCopyContent } from './MessageCopyMenu';

export const FOLD_CHARS = 1000;
/** Extra end pad so glyph ink that overshoots advance width is not clipped. */
export const USER_BUBBLE_TEXT_END_PAD = 3;

const textOf = (entry: MessageEntry): string =>
  entry.parts
    .filter(
      (p): p is { kind: 'text'; id: string; text: string } => p.kind === 'text',
    )
    .map(p => p.text)
    .join('\n');

function EnteringStack({
  animate,
  children,
}: {
  animate: boolean;
  children: ReactNode;
}) {
  'use no memo';
  const reduceMotion = useReducedMotion();
  return (
    <Animated.View
      style={styles.stack}
      entering={
        animate && !reduceMotion
          ? SlideInDown.easing(Easing.out(Easing.exp)).duration(700)
          : undefined
      }
    >
      {children}
    </Animated.View>
  );
}

export const UserMessage = React.memo(function UserMessageInner({
  entry,
  animateEnter = false,
  onEntered,
}: {
  entry: MessageEntry;
  chatId?: string;
  animateEnter?: boolean;
  onEntered?: (id: string) => void;
}) {
  'use no memo';
  const theme = useTheme();
  const [expanded, setExpanded] = useState(false);
  const text = textOf(entry);
  const { kind, text: visible } = stripPlanPrefix(text);
  const images = entry.parts.filter(p => p.kind === 'image');
  const foldable = visible.length > FOLD_CHARS;
  const shown =
    expanded || !foldable ? visible : `${visible.slice(0, FOLD_CHARS)}…`;
  const showBubble = visible !== '' || kind !== null;

  useLayoutEffect(() => {
    if (animateEnter) onEntered?.(entry.id);
  }, [animateEnter, entry.id, onEntered]);

  return (
    <View style={styles.row}>
      <ContextMenu.Root>
        <ContextMenu.Trigger>
          <EnteringStack animate={animateEnter}>
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
                      <Icon
                        name="photo"
                        size={13}
                        color={theme.textSecondary}
                      />
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
            {showBubble ? (
              <FrostedBubble
                testID="user-bubble"
                style={styles.bubble}
                contentStyle={styles.bubblePad}
                tintColor={theme.userBubbleBackground}
              >
                {kind !== null ? <PlanBadge kind={kind} /> : null}
                {shown !== '' ? (
                  <Text style={[styles.text, { color: theme.userBubbleText }]}>
                    {shown}
                  </Text>
                ) : null}
                {foldable ? (
                  <Pressable
                    testID="user-bubble-fold"
                    onPress={() => setExpanded(e => !e)}
                    hitSlop={6}
                    accessibilityRole="button"
                    accessibilityLabel={
                      expanded ? t('session.showLess') : t('session.showMore')
                    }
                    accessibilityState={{ expanded }}
                  >
                    <Text style={[styles.fold, { color: theme.textSecondary }]}>
                      {expanded ? t('session.showLess') : t('session.showMore')}
                    </Text>
                  </Pressable>
                ) : null}
              </FrostedBubble>
            ) : null}
          </EnteringStack>
        </ContextMenu.Trigger>
        {messageCopyContent(visible)}
      </ContextMenu.Root>
    </View>
  );
});

const styles = StyleSheet.create({
  row: {
    alignItems: 'flex-end',
    paddingHorizontal: 16,
    paddingVertical: 4,
  },
  stack: {
    alignSelf: 'flex-end',
    alignItems: 'flex-end',
  },
  attachmentRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: 6,
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
    alignSelf: 'flex-end',
    maxWidth: '82%',
    borderRadius: 20,
  },
  bubblePad: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    gap: 6,
  },
  text: {
    fontSize: 16,
    lineHeight: 21,
    flexShrink: 0,
    paddingEnd: USER_BUBBLE_TEXT_END_PAD,
  },
  fold: { fontSize: 13, fontWeight: '500', marginTop: 4 },
});
