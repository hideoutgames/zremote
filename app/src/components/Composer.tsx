// Session composer: the fork's glass pill + thumbnail strip, wired to
// draftStore (per-chat text survives session switches), composerAction for
// send/steer/stop, and QuestionPanel when the agent is asking. Attachments
// stage locally only — sending with attachments is blocked until upload
// ships (never silently dropped).

import React, { useCallback } from 'react';
import {
  type LayoutChangeEvent,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  Easing,
  useAnimatedStyle,
  withTiming,
} from 'react-native-reanimated';
import { NitroImage } from 'react-native-nitro-image';
import { AttachmentMenu } from './AttachmentMenu';
import { Glass } from './Glass';
import { Icon } from './Icon';
import { useAttachments } from '../hooks/useAttachments';
import { useTheme } from '../theme';
import { t } from '../i18n/strings';
import { useDraft, setDraftText } from '../zeron/state/draftStore';
import {
  openInputRequest,
  useSessionState,
  type RunPhase,
} from '../zeron/state/sessionStores';
import type { HarnessDescriptor } from '../zeron/protocol/types';
import { composerAction } from './composerAction';
import { QuestionPanel } from './agentsKit/QuestionPanel';

const INPUT_MAX_HEIGHT = 120;
const THUMBS_ANIM_MS = 220;

export interface ComposerProps {
  chatId: string;
  phase: RunPhase;
  harness?: HarnessDescriptor;
  onSend: (text: string) => void;
  onSteer: (text: string) => void;
  onStop: () => void;
  onRespondInput: (
    requestId: string,
    answers: { questionId: string; labels: string[] }[],
  ) => void;
  onAttachmentsBlocked: () => void;
  composerRef: React.RefObject<View | null>;
  onLayout: (event: LayoutChangeEvent) => void;
}

export const Composer = React.memo(function ({
  chatId,
  phase,
  harness,
  onSend,
  onSteer,
  onStop,
  onRespondInput,
  onAttachmentsBlocked,
  composerRef,
  onLayout,
}: ComposerProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const draft = useDraft(chatId);
  const { pickImages, remove } = useAttachments(chatId);
  const session = useSessionState(chatId);

  const question = openInputRequest(session.entries);
  const hasAttachments = draft.attachments.length > 0;
  const action = composerAction(phase, harness, draft.text.trim().length > 0);

  const submit = useCallback(() => {
    if (hasAttachments) {
      onAttachmentsBlocked();
      return;
    }
    const text = draft.text.trim();
    if (text === '') return;
    if (action.primary === 'steer') onSteer(text);
    else if (action.primary === 'send') onSend(text);
    else return;
    setDraftText(chatId, '');
  }, [
    hasAttachments,
    draft.text,
    action.primary,
    onSteer,
    onSend,
    onAttachmentsBlocked,
    chatId,
  ]);

  const [thumbsContentHeight, setThumbsContentHeight] = React.useState(0);
  const thumbsStyle = useAnimatedStyle(() => ({
    height: withTiming(hasAttachments ? thumbsContentHeight : 0, {
      duration: THUMBS_ANIM_MS,
      easing: Easing.inOut(Easing.ease),
    }),
    opacity: withTiming(hasAttachments ? 1 : 0, {
      duration: THUMBS_ANIM_MS,
      easing: Easing.inOut(Easing.ease),
    }),
  }));

  const right = action.right;

  return (
    <View
      ref={composerRef}
      onLayout={onLayout}
      style={[styles.container, { paddingBottom: insets.bottom + 8 }]}
    >
      {question !== undefined ? (
        <QuestionPanel
          requestId={question.requestId}
          questions={question.questions}
          onSubmit={onRespondInput}
        />
      ) : null}

      <View style={styles.row}>
        <AttachmentMenu onPickPhotos={pickImages} />
        <View style={styles.inputPillWrap}>
          <Glass style={styles.inputPill}>
            <Animated.View
              style={[styles.thumbsClip, thumbsStyle]}
              pointerEvents={hasAttachments ? 'auto' : 'none'}
            >
              <View
                style={styles.thumbs}
                onLayout={event => {
                  const next = Math.ceil(event.nativeEvent.layout.height);
                  setThumbsContentHeight(cur =>
                    Math.abs(cur - next) <= 1 ? cur : next,
                  );
                }}
              >
                {draft.attachments.map(a => (
                  <View key={a.id} style={styles.thumbWrap}>
                    <NitroImage
                      image={{ filePath: a.localUri }}
                      style={styles.thumb}
                    />
                    <Pressable
                      style={styles.thumbRemove}
                      hitSlop={8}
                      onPress={() => remove(a.id)}
                    >
                      <View style={styles.thumbRemoveBadge}>
                        <Icon name="xmark" size={11} color="#FFFFFF" />
                      </View>
                    </Pressable>
                  </View>
                ))}
              </View>
            </Animated.View>

            <TextInput
              value={draft.text}
              onChangeText={text => setDraftText(chatId, text)}
              placeholder={
                action.primary === 'steer'
                  ? t('session.steerPlaceholder')
                  : t('session.messagePlaceholder')
              }
              placeholderTextColor={theme.textSecondary}
              style={[styles.input, { color: theme.text }]}
              multiline
            />
          </Glass>
        </View>

        {action.primary === 'steer' ? (
          <Pressable onPress={submit} hitSlop={6} style={styles.steerBtn}>
            <Glass interactive style={styles.steerPill}>
              <Text style={[styles.steerText, { color: theme.accent }]}>
                {t('session.steer')}
              </Text>
            </Glass>
          </Pressable>
        ) : null}

        <Pressable
          onPress={
            right === 'stop' ? onStop : right === 'send' ? submit : undefined
          }
          disabled={
            right === 'stopping' ||
            (right === 'send' && action.primary !== 'send')
          }
          hitSlop={6}
        >
          <Glass interactive style={styles.circle}>
            <Icon
              name={
                right === 'stop' || right === 'stopping'
                  ? 'stop.fill'
                  : 'arrow.up'
              }
              size={right === 'send' ? 20 : 15}
              color={
                right === 'stopping' ||
                (right === 'send' && action.primary !== 'send')
                  ? theme.sendInactive
                  : theme.sendActive
              }
            />
          </Glass>
        </Pressable>
      </View>
      {right === 'stopping' ? (
        <Text style={[styles.hint, { color: theme.textSecondary }]}>
          {t('session.stopping')}
        </Text>
      ) : null}
    </View>
  );
});

const CIRCLE = 44;

const styles = StyleSheet.create({
  container: { paddingHorizontal: 12, paddingTop: 8, gap: 8 },
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  circle: {
    width: CIRCLE,
    height: CIRCLE,
    borderRadius: CIRCLE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  steerBtn: {},
  steerPill: {
    height: CIRCLE,
    borderRadius: CIRCLE / 2,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  steerText: { fontSize: 15, fontWeight: '600' },
  inputPillWrap: { flex: 1 },
  inputPill: {
    minHeight: CIRCLE,
    borderRadius: 24,
    justifyContent: 'center',
    paddingHorizontal: 14,
    paddingVertical: 6,
    overflow: 'hidden',
  },
  input: { fontSize: 16, paddingVertical: 4, maxHeight: INPUT_MAX_HEIGHT },
  thumbsClip: { overflow: 'hidden' },
  thumbs: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingTop: 2,
    paddingBottom: 8,
  },
  thumbWrap: { width: 120, height: 120, borderRadius: 18, overflow: 'hidden' },
  thumb: { width: 120, height: 120, borderRadius: 16 },
  thumbRemove: { position: 'absolute', top: 6, right: 6 },
  thumbRemoveBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  hint: { fontSize: 12, textAlign: 'center' },
});
