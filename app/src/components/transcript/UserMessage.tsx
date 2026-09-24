// User transcript row (message bubble): text bubble, attachment chips, and
// the "Show more" fold at 1000 characters. Short messages are never
// ellipsized. Message-row shape follows Agents Kit beui/message +
// prompt-kit/message (both MIT) — a plain bubble; no avatar chrome.
// Expanded prompts are chunked into multiple Text nodes so a single CALayer
// cannot exceed iOS's max texture size (blank glyphs, tall empty frost).

import React, { useLayoutEffect, useState, type ReactNode } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
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
import { stripPlanPrefix, type PromptBadgeKind } from '../planMode';
import { PlanBadge } from '../PlanBadge';
import { ComposerReferenceText } from '../ComposerReferenceText';
import { FrostedBubble } from './FrostedBubble';
import { messageCopyContent } from './MessageCopyMenu';
import { useSuppressAfterLongPress } from '../../hooks/useSuppressAfterLongPress';

export const FOLD_CHARS = 1000;
/** Extra end pad so glyph ink that overshoots advance width is not clipped. */
export const USER_BUBBLE_TEXT_END_PAD = 3;
/** Cap vs the full transcript row, not the shrink-wrapped bubble. */
export const USER_BUBBLE_MAX_WIDTH = '82%';
/** Soft cap per Text node so expanded prompts stay under the iOS layer limit. */
export const PROMPT_CHUNK_CHARS = 800;
/** Expanded bubble body vs the window — keeps the frost from becoming a slab. */
export const EXPANDED_BUBBLE_MAX_HEIGHT_FRACTION = 0.55;

const textOf = (entry: MessageEntry): string =>
  entry.parts
    .filter(
      (p): p is { kind: 'text'; id: string; text: string } => p.kind === 'text',
    )
    .map(p => p.text)
    .join('\n');

export const chunkPromptText = (
  text: string,
  maxChars: number = PROMPT_CHUNK_CHARS,
): string[] => {
  if (maxChars <= 0) return [text];
  if (text.length <= maxChars) return [text];
  const chunks: string[] = [];
  let current = '';
  const flush = () => {
    if (current === '') return;
    chunks.push(current);
    current = '';
  };
  const takeHard = (piece: string) => {
    for (let offset = 0; offset < piece.length; offset += maxChars) {
      const slice = piece.slice(offset, offset + maxChars);
      if (offset + maxChars < piece.length) {
        chunks.push(slice);
      } else {
        current = slice;
      }
    }
  };
  for (const line of text.split('\n')) {
    const joined = current === '' ? line : `${current}\n${line}`;
    if (joined.length <= maxChars) {
      current = joined;
      continue;
    }
    flush();
    if (line.length <= maxChars) {
      current = line;
    } else {
      takeHard(line);
    }
  }
  flush();
  return chunks.length > 0 ? chunks : [''];
};

const promptBody = (
  kind: PromptBadgeKind | null,
  shown: string,
  color: string,
): ReactNode => {
  const hasRef =
    shown.includes('zeron-invoke:') || shown.includes('zeron-file:');
  const body = hasRef ? (
    <ComposerReferenceText key="refs" canonical={shown} color={color} />
  ) : (
    shown
  );
  if (kind === null) return body;
  const badge = <PlanBadge key="badge" kind={kind} variant="inline" />;
  if (shown === '') return badge;
  return [badge, ' ', body];
};

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
  const { height: windowHeight } = useWindowDimensions();
  const lp = useSuppressAfterLongPress();
  const [expanded, setExpanded] = useState(false);
  const text = textOf(entry);
  const { kind, text: visible } = stripPlanPrefix(text);
  const images = entry.parts.filter(p => p.kind === 'image');
  const foldable = visible.length > FOLD_CHARS;
  const shown =
    expanded || !foldable ? visible : `${visible.slice(0, FOLD_CHARS)}…`;
  const showBubble = visible !== '' || kind !== null;
  const chunks = chunkPromptText(shown);
  const prompts = chunks.map((chunk, i) => (
    <Text
      key={i}
      testID={i === 0 ? 'user-bubble-prompt' : `user-bubble-prompt-${i}`}
      style={[styles.text, { color: theme.userBubbleText }]}
    >
      {i === 0
        ? promptBody(kind, chunk, theme.userBubbleText)
        : promptBody(null, chunk, theme.userBubbleText)}
    </Text>
  ));

  useLayoutEffect(() => {
    if (animateEnter) onEntered?.(entry.id);
  }, [animateEnter, entry.id, onEntered]);

  return (
    <View testID="user-message" style={styles.row}>
      <View testID="user-bubble-cap" style={styles.cap}>
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
                  {expanded ? (
                    <ScrollView
                      testID="user-bubble-scroll"
                      nestedScrollEnabled
                      style={{
                        maxHeight: Math.round(
                          windowHeight * EXPANDED_BUBBLE_MAX_HEIGHT_FRACTION,
                        ),
                      }}
                    >
                      {prompts}
                    </ScrollView>
                  ) : (
                    prompts
                  )}
                  {foldable ? (
                    <Pressable
                      testID="user-bubble-fold"
                      onPress={() => {
                        if (lp.isSuppressed()) return;
                        setExpanded(e => !e);
                      }}
                      onPressIn={lp.onPressIn}
                      onLongPress={lp.onLongPress}
                      hitSlop={6}
                      accessibilityRole="button"
                      accessibilityLabel={
                        expanded ? t('session.showLess') : t('session.showMore')
                      }
                      accessibilityState={{ expanded }}
                    >
                      <Text
                        style={[styles.fold, { color: theme.textSecondary }]}
                      >
                        {expanded
                          ? t('session.showLess')
                          : t('session.showMore')}
                      </Text>
                    </Pressable>
                  ) : null}
                </FrostedBubble>
              ) : null}
            </EnteringStack>
          </ContextMenu.Trigger>
          {messageCopyContent(visible, entry.createdAt)}
        </ContextMenu.Root>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  row: {
    alignSelf: 'stretch',
    width: '100%',
    alignItems: 'flex-end',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  // Percentage maxWidth must resolve against the row, not the bubble. A
  // shrink-wrapped parent makes 82% mean "82% of the text", which the
  // frosted clip then hides (Copy still has the full string).
  cap: {
    maxWidth: USER_BUBBLE_MAX_WIDTH,
  },
  stack: {
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
    maxWidth: '100%',
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
    paddingEnd: USER_BUBBLE_TEXT_END_PAD,
  },
  fold: { fontSize: 13, fontWeight: '500', marginTop: 4 },
});
