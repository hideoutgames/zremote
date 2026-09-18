// Session composer — one two-tier Liquid Glass container:
//   upper tier: attachment strip + always-mounted TextInput (QuestionPanel
//     renders above the lower tier inside the same glass, de-emphasizing —
//     never unmounting — the input),
//   lower tier: [+] attachment menu · live Queue/Steer pill ·
//     [Agent · Model] button · mic · right circle (send/stop/stopping/cancel).
// All decisions route through composerAction/liveAction + the draftStore;
// attachment sends go through onSendAttachments (queued `pending://` flow or
// legacy upload-first — never a device-local URI on the wire).

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  type LayoutChangeEvent,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  useReducedMotion,
  Easing,
  useAnimatedStyle,
  withTiming,
} from 'react-native-reanimated';
import { NitroImage } from 'react-native-nitro-image';
import * as DropdownMenu from 'zeego/dropdown-menu';
import { AttachmentMenu } from './AttachmentMenu';
import { Glass } from './Glass';
import { Icon } from './Icon';
import { useAttachments } from '../hooks/useAttachments';
import { useTheme } from '../theme';
import { t } from '../i18n/strings';
import {
  clearDraft,
  removeAttachment,
  setDraftText,
  useDraft,
} from '../zeron/state/draftStore';
import {
  openInputRequest,
  useSessionState,
  type RoomState,
  type RunPhase,
} from '../zeron/state/sessionStores';
import { BorderBeam } from './agentsKit/BorderBeam';
import {
  useLiveActionPrefersSteer,
  setLiveActionPrefersSteer,
  uiPrefsStore,
} from '../zeron/state/uiPrefs';
import type { HarnessDescriptor } from '../zeron/protocol/types';
import { composerAction, harnessSteers, liveAction } from './composerAction';
import type { SendPlan } from '../zeron/attachments/sendPlan';
import type { DictationPort } from '../zeron/native/dictation';
import { QuestionPanel } from './agentsKit/QuestionPanel';

// Input grows to ~6 lines on compact width, ~9 lines on iPad (fontSize 17 /
// lineHeight 22 → 22*6+16 = 148, 22*9+16 = 214).
const INPUT_MAX_HEIGHT_COMPACT = 148;
const INPUT_MAX_HEIGHT_REGULAR = 214;
const THUMBS_ANIM_MS = 220;

export interface ComposerProps {
  chatId: string;
  phase: RunPhase;
  roomState: RoomState;
  harness?: HarnessDescriptor;
  /** Host capability strings (message-queue-v1 et al). */
  capabilities: ReadonlySet<string>;
  /** e.g. "Claude · Opus 4.7" for the lower-tier picker button. */
  modelLabel: string;
  onOpenModelPicker: () => void;
  onOpenQueue: () => void;
  dictation: DictationPort;
  onSend: (text: string) => void;
  onSteer: (text: string) => void;
  onQueue: (text: string) => void;
  onStop: () => void;
  /** queuedLocally/synchronized → cancelOwnCommand on the own pending run. */
  onCancel: () => void;
  /** Orchestrates staged-attachment sends; resolves to the plan taken. */
  onSendAttachments: (text: string) => Promise<SendPlan>;
  onRespondInput: (
    requestId: string,
    answers: { questionId: string; labels: string[] }[],
  ) => void;
  /** The send was refused (e.g. attachments while live without queue
   * support) — the parent surfaces it; nothing is silently dropped. */
  onSendBlocked: () => void;
  composerRef: React.RefObject<View | null>;
  onLayout: (event: LayoutChangeEvent) => void;
}

export const Composer = React.memo(function ({
  chatId,
  phase,
  roomState,
  harness,
  capabilities,
  modelLabel,
  onOpenModelPicker,
  onOpenQueue,
  dictation,
  onSend,
  onSteer,
  onQueue,
  onStop,
  onCancel,
  onSendAttachments,
  onRespondInput,
  onSendBlocked,
  composerRef,
  onLayout,
}: ComposerProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const inputMaxHeight =
    windowWidth >= 700 ? INPUT_MAX_HEIGHT_REGULAR : INPUT_MAX_HEIGHT_COMPACT;
  const draft = useDraft(chatId);
  const { pickImages, pickCamera, pickFiles } = useAttachments(chatId);
  const session = useSessionState(chatId);
  const prefersSteer = useLiveActionPrefersSteer();

  const question = openInputRequest(session.entries);
  const hasAttachments = draft.attachments.length > 0;
  const hasText = draft.text.trim().length > 0;
  const action = composerAction(phase, harness, hasText);
  const live = liveAction(
    phase,
    capabilities.has('message-queue-v1'),
    harnessSteers(harness),
    prefersSteer,
  );

  // ── Dictation ─────────────────────────────────────────────────────────
  const [dictationSupported, setDictationSupported] = useState(false);
  const [dictating, setDictating] = useState(false);
  const baseRef = useRef('');
  const selRef = useRef(0);
  // Partials/finals splice into the draft at the caret position captured
  // when dictation started (baseRef/selRef) — partials replace each other,
  // the final replaces the last partial.
  const dictationCb = useRef({
    onPartial: (text: string) =>
      setDraftText(
        chatId,
        `${baseRef.current.slice(
          0,
          selRef.current,
        )}${text}${baseRef.current.slice(selRef.current)}`,
      ),
    onFinal: (text: string) => {
      setDraftText(
        chatId,
        `${baseRef.current.slice(
          0,
          selRef.current,
        )}${text}${baseRef.current.slice(selRef.current)}`,
      );
      setDictating(false);
    },
    onError: () => setDictating(false),
  });
  useEffect(() => {
    dictationCb.current.onPartial = text =>
      setDraftText(
        chatId,
        `${baseRef.current.slice(
          0,
          selRef.current,
        )}${text}${baseRef.current.slice(selRef.current)}`,
      );
    dictationCb.current.onFinal = text => {
      setDraftText(
        chatId,
        `${baseRef.current.slice(
          0,
          selRef.current,
        )}${text}${baseRef.current.slice(selRef.current)}`,
      );
      setDictating(false);
    };
  }, [chatId]);

  useEffect(() => {
    let mounted = true;
    dictation
      .isSupported()
      .then(r => {
        if (mounted) setDictationSupported(r.supported);
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, [dictation]);

  // Stop dictation on background / unmount (never leak the mic).
  useEffect(() => {
    const sub = AppState.addEventListener('change', s => {
      if (s !== 'active' && dictating) {
        dictation.stop().catch(() => {});
        setDictating(false);
      }
    });
    return () => {
      sub.remove();
      if (dictating) dictation.stop().catch(() => {});
    };
  }, [dictation, dictating]);

  const toggleDictation = useCallback(() => {
    if (dictating) {
      dictation.stop().catch(() => {});
      setDictating(false);
      return;
    }
    baseRef.current = draft.text;
    dictation
      .start(
        { locale: uiPrefsStore.getState().dictationLocale },
        dictationCb.current,
      )
      .then(() => setDictating(true))
      .catch(() => setDictating(false));
  }, [dictating, dictation, draft.text]);

  const submit = useCallback(() => {
    const text = draft.text.trim();
    if (hasAttachments) {
      // Routes per sendPlan; 'blocked' surfaces onSendBlocked — the draft
      // and attachments stay put (nothing silently dropped).
      onSendAttachments(text).then(plan => {
        if (plan === 'blocked') {
          onSendBlocked();
        } else if (plan !== 'direct') {
          clearDraft(chatId);
        }
      });
      return;
    }
    if (text === '') return;
    if (live === 'queue' && phase !== 'idle') {
      onQueue(text);
      setDraftText(chatId, '');
      return;
    }
    if (live === 'steer' && phase !== 'idle' && text !== '') {
      onSteer(text);
      setDraftText(chatId, '');
      return;
    }
    if (action.primary === 'steer') onSteer(text);
    else if (action.primary === 'send') onSend(text);
    else return;
    setDraftText(chatId, '');
  }, [
    hasAttachments,
    draft.text,
    action.primary,
    live,
    phase,
    onSteer,
    onSend,
    onQueue,
    onSendAttachments,
    onSendBlocked,
    chatId,
  ]);

  const [stripContentHeight, setStripContentHeight] = useState(0);
  // Reduce Motion: thumbs/strip animate instantly (no swell/shrink).
  const reduceMotion = useReducedMotion();
  const stripStyle = useAnimatedStyle(() => ({
    height: withTiming(hasAttachments ? stripContentHeight : 0, {
      duration: reduceMotion ? 0 : THUMBS_ANIM_MS,
      easing: Easing.inOut(Easing.ease),
    }),
    opacity: withTiming(hasAttachments ? 1 : 0, {
      duration: reduceMotion ? 0 : THUMBS_ANIM_MS,
      easing: Easing.inOut(Easing.ease),
    }),
  }));

  const right = action.right;
  const showLivePill = live !== 'hidden' && hasText;

  // Beam geometry = the glass's own bounds; Reduce Motion collapses the
  // sweep to a static ring.
  const [glassSize, setGlassSize] = useState({ w: 0, h: 0 });

  return (
    <View
      ref={composerRef}
      onLayout={onLayout}
      style={[styles.container, { paddingBottom: insets.bottom + 8 }]}
    >
      <View
        style={styles.glassWrap}
        onLayout={e =>
          setGlassSize({
            w: e.nativeEvent.layout.width,
            h: e.nativeEvent.layout.height,
          })
        }
      >
        <Glass style={styles.glass}>
          {/* ── Upper tier: attachment strip + input ──────────────────── */}
          <Animated.View
            style={[styles.stripClip, stripStyle]}
            pointerEvents={hasAttachments ? 'auto' : 'none'}
          >
            <View
              style={styles.strip}
              onLayout={event => {
                const next = Math.ceil(event.nativeEvent.layout.height);
                setStripContentHeight(cur =>
                  Math.abs(cur - next) <= 1 ? cur : next,
                );
              }}
            >
              {draft.attachments.map(a =>
                a.kind === 'image' ? (
                  <View key={a.id} style={styles.thumbWrap}>
                    <NitroImage
                      image={{ filePath: a.localUri }}
                      style={styles.thumb}
                    />
                    {a.uploadState === 'uploading' ? (
                      <ActivityIndicator
                        style={styles.thumbProgress}
                        size="small"
                      />
                    ) : null}
                    <Pressable
                      style={styles.thumbRemove}
                      hitSlop={8}
                      accessibilityLabel={t(
                        'composer.removeAttachment',
                      ).replace('{name}', a.name)}
                      onPress={() => removeAttachment(chatId, a.id)}
                    >
                      <View style={styles.thumbRemoveBadge}>
                        <Icon name="xmark" size={11} color="#FFFFFF" />
                      </View>
                    </Pressable>
                  </View>
                ) : (
                  <View
                    key={a.id}
                    style={[styles.fileChip, { borderColor: theme.border }]}
                  >
                    <Icon name="doc" size={14} color={theme.textSecondary} />
                    <Text
                      style={[styles.fileChipText, { color: theme.text }]}
                      numberOfLines={1}
                    >
                      {a.name}
                    </Text>
                    <Text
                      style={[
                        styles.fileChipSize,
                        { color: theme.textSecondary },
                      ]}
                    >
                      {formatBytes(a.size)}
                    </Text>
                    {a.uploadState === 'uploading' ? (
                      <ActivityIndicator size="small" />
                    ) : null}
                    <Pressable
                      hitSlop={8}
                      accessibilityLabel={t(
                        'composer.removeAttachment',
                      ).replace('{name}', a.name)}
                      onPress={() => removeAttachment(chatId, a.id)}
                    >
                      <Icon
                        name="xmark.circle.fill"
                        size={16}
                        color={theme.textSecondary}
                      />
                    </Pressable>
                  </View>
                ),
              )}
            </View>
          </Animated.View>

          {/* QuestionPanel renders above the lower tier inside the same
            glass; the input stays mounted, de-emphasized. */}
          {question !== undefined ? (
            <QuestionPanel
              requestId={question.requestId}
              questions={question.questions}
              onSubmit={onRespondInput}
            />
          ) : null}

          <TextInput
            value={draft.text}
            onChangeText={text => setDraftText(chatId, text)}
            onSelectionChange={e =>
              (selRef.current = e.nativeEvent.selection.start)
            }
            placeholder={
              live === 'queue'
                ? t('session.queuePlaceholder')
                : action.primary === 'steer'
                ? t('session.steerPlaceholder')
                : t('session.messagePlaceholder')
            }
            placeholderTextColor={theme.textSecondary}
            style={[
              styles.input,
              { color: theme.text, maxHeight: inputMaxHeight },
              question !== undefined ? styles.inputDimmed : undefined,
            ]}
            multiline
            accessibilityLabel={t('session.messagePlaceholder')}
            // Cmd+Enter: RN 0.86 onKeyPress exposes key but no modifier
            // flags on iOS — handled in the parent where available; the
            // modifier gap is documented in docs/ARCHITECTURE.md.
          />

          {/* ── Lower tier: [+] · queue/steer pill · model · mic · right ─
              (no separator — spacing only, per the single-surface design) ── */}
          <View style={styles.lowerRow}>
            <AttachmentMenu
              onPickPhotos={pickImages}
              onPickCamera={pickCamera}
              onPickFiles={pickFiles}
            />

            {showLivePill ? (
              <DropdownMenu.Root>
                <DropdownMenu.Trigger>
                  <View
                    style={[styles.livePill, { borderColor: theme.accent }]}
                  >
                    <Text
                      style={[styles.livePillText, { color: theme.accent }]}
                    >
                      {live === 'queue'
                        ? t('session.queue')
                        : t('session.steer')}
                    </Text>
                  </View>
                </DropdownMenu.Trigger>
                <DropdownMenu.Content>
                  <DropdownMenu.Item
                    key="queue"
                    onSelect={() => setLiveActionPrefersSteer(false)}
                  >
                    <DropdownMenu.ItemTitle>
                      {t('session.queue')}
                    </DropdownMenu.ItemTitle>
                  </DropdownMenu.Item>
                  <DropdownMenu.Item
                    key="steer"
                    onSelect={() => setLiveActionPrefersSteer(true)}
                  >
                    <DropdownMenu.ItemTitle>
                      {t('session.steer')}
                    </DropdownMenu.ItemTitle>
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Root>
            ) : null}

            <Pressable
              style={[
                styles.modelBtn,
                { backgroundColor: theme.inputBackground },
              ]}
              onPress={onOpenModelPicker}
              hitSlop={4}
              accessibilityRole="button"
              accessibilityLabel={modelLabel}
            >
              <Text
                style={[styles.modelText, { color: theme.text }]}
                numberOfLines={1}
              >
                {modelLabel}
              </Text>
              <Icon name="chevron.down" size={11} color={theme.textSecondary} />
            </Pressable>

            {session.queue.length > 0 ? (
              <Pressable
                onPress={onOpenQueue}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel={`${t('session.queue')} (${
                  session.queue.length
                })`}
                style={styles.minTarget}
              >
                <Text style={[styles.queueBadge, { color: theme.accent }]}>
                  {session.queue.length}
                </Text>
              </Pressable>
            ) : null}

            <View style={styles.spacer} />

            <Pressable
              onPress={toggleDictation}
              disabled={!dictationSupported}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel={t('composer.dictate')}
              accessibilityState={{
                disabled: !dictationSupported,
                busy: dictating,
              }}
              accessibilityHint={
                dictationSupported
                  ? undefined
                  : t('composer.dictationUnavailable')
              }
              style={styles.minTarget}
            >
              <View
                style={[
                  styles.circle,
                  { backgroundColor: theme.inputBackground },
                ]}
              >
                <Icon
                  name={dictating ? 'stop.circle.fill' : 'mic'}
                  size={17}
                  color={
                    !dictationSupported
                      ? theme.sendInactive
                      : dictating
                      ? theme.danger
                      : theme.textSecondary
                  }
                />
              </View>
            </Pressable>

            <Pressable
              onPress={
                right === 'stop'
                  ? onStop
                  : right === 'cancel'
                  ? onCancel
                  : right === 'send'
                  ? submit
                  : undefined
              }
              disabled={
                right === 'stopping' ||
                (right === 'send' && action.primary !== 'send')
              }
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel={
                right === 'stop'
                  ? t('session.stop')
                  : right === 'stopping'
                  ? t('session.stopping')
                  : right === 'cancel'
                  ? t('session.cancel')
                  : t('session.send')
              }
              accessibilityState={{
                disabled:
                  right === 'stopping' ||
                  (right === 'send' && action.primary !== 'send'),
                busy: right === 'stopping',
              }}
              style={styles.minTarget}
            >
              <View
                style={[
                  styles.circle,
                  {
                    backgroundColor:
                      right === 'send' && action.primary !== 'send'
                        ? theme.sendInactive
                        : theme.sendActive,
                  },
                ]}
              >
                {right === 'stopping' ? (
                  <ActivityIndicator size="small" color={theme.textSecondary} />
                ) : (
                  <Icon
                    name={
                      right === 'stop'
                        ? 'stop.fill'
                        : right === 'cancel'
                        ? 'xmark'
                        : 'arrow.up'
                    }
                    size={right === 'send' ? 17 : 15}
                    color={
                      right === 'send' && action.primary !== 'send'
                        ? '#FFFFFF'
                        : theme.scheme === 'dark'
                        ? '#000000'
                        : '#FFFFFF'
                    }
                  />
                )}
              </View>
            </Pressable>
          </View>
        </Glass>
        <BorderBeam
          width={glassSize.w}
          height={glassSize.h}
          radius={24}
          runPhase={phase}
          roomState={roomState}
          reduceMotion={reduceMotion}
        />
      </View>

      {right === 'stopping' ? (
        <Text style={[styles.hint, { color: theme.textSecondary }]}>
          {t('session.stopping')}
        </Text>
      ) : null}
      {live === 'hidden' &&
      (phase === 'working' || phase === 'awaitingInput') ? (
        <Text style={[styles.hint, { color: theme.textSecondary }]}>
          {t('session.workingHint')}
        </Text>
      ) : null}
    </View>
  );
});

const formatBytes = (n: number): string => {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
};

const CIRCLE = 32;

const styles = StyleSheet.create({
  container: { paddingHorizontal: 12, paddingTop: 8, gap: 8 },
  glassWrap: { position: 'relative' },
  glass: {
    borderRadius: 24,
    overflow: 'hidden',
  },
  lowerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 8,
    paddingTop: 2,
    paddingBottom: 8,
  },
  minTarget: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  circle: {
    width: CIRCLE,
    height: CIRCLE,
    borderRadius: CIRCLE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  input: {
    fontSize: 17,
    lineHeight: 22,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 4,
    minHeight: 60,
    textAlignVertical: 'top',
  },
  inputDimmed: { opacity: 0.45 },
  stripClip: { overflow: 'hidden' },
  strip: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 12,
    paddingBottom: 8,
  },
  thumbWrap: { width: 96, height: 96, borderRadius: 14, overflow: 'hidden' },
  thumb: { width: 96, height: 96, borderRadius: 12 },
  thumbProgress: {
    position: 'absolute',
    alignSelf: 'center',
    top: 38,
  },
  thumbRemove: { position: 'absolute', top: 6, right: 6 },
  thumbRemoveBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fileChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
    maxWidth: '100%',
  },
  fileChipText: { fontSize: 13, maxWidth: 140 },
  fileChipSize: { fontSize: 11 },
  livePill: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  livePillText: { fontSize: 12, fontWeight: '600' },
  modelBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 32,
    borderRadius: 16,
    paddingHorizontal: 10,
    gap: 4,
    maxWidth: '46%',
  },
  modelText: { fontSize: 13 },
  spacer: { flex: 1 },
  queueBadge: { fontSize: 13, fontWeight: '700' },
  hint: { fontSize: 12, textAlign: 'center' },
});
