// Session composer — one two-tier Liquid Glass container:
//   grabber, then (compose only) Desktop / Project / checkout-mode / Branch,
//   upper tier: attachment strip + always-mounted TextInput (QuestionPanel
//     renders above the lower tier inside the same glass, de-emphasizing —
//     never unmounting — the input),
//   action row: [+] · live Queue/Steer · Plan · model · effort · fast · voice · send.
// Host / repo / origin live on the thread Details sheet for existing sessions.
// All decisions route through composerAction/liveAction + the draftStore;
// attachment sends go through onSendAttachments (queued `pending://` flow or
// legacy upload-first — never a device-local URI on the wire).

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Keyboard,
  type LayoutChangeEvent,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { Canvas, LinearGradient, Rect, vec } from '@shopify/react-native-skia';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useReducedMotion } from 'react-native-reanimated';
import { KeyboardController } from 'react-native-keyboard-controller';
import * as DropdownMenu from './menus/dropdown-menu';
import { AttachmentMenu } from './AttachmentMenu';
import { AttachmentStrip, ATTACHMENT_TILE } from './AttachmentStrip';
import { ImagePreviewModal } from './ImagePreviewModal';
import { TextFileSheet } from './TextFileSheet';
import { CheckoutChips, type CheckoutChipsProps } from './CheckoutSelector';
import { Glass } from './Glass';
import { FadeBlur } from './FadeBlur';
import { Icon } from './Icon';
import { ModelMenuButton } from './ModelMenuButton';
import { FastMenuButton } from './FastMenuButton';
import { ComposerMenuChip } from './ComposerMenuChip';
import { PlanBadge } from './PlanBadge';
import type { EffortOrigin } from './EffortOverlay';
import type { CatalogModelRef } from '../zeron/state/recentModels';
import { withPlanPrefixIf } from './planMode';
import { VOICE_PILL_SIZE } from './voicePillMath';
import { useAttachments } from '../hooks/useAttachments';
import { isImageMime } from '../zeron/attachments/validate';
import { useTheme } from '../theme';
import { t } from '../i18n/strings';
import {
  clearDraft,
  removeAttachment,
  setDraftText,
  useDraft,
  type StagedAttachment,
} from '../zeron/state/draftStore';
import {
  openInputRequest,
  useSessionState,
  type RoomState,
  type RunPhase,
} from '../zeron/state/sessionStores';
import { BorderBeam } from './agentsKit/BorderBeam';
import { AttachmentStripAnim } from './AttachmentStripAnim';
import {
  useLiveActionPrefersSteer,
  setLiveActionPrefersSteer,
  uiPrefsStore,
  usePlanMode,
  setPlanMode,
  useComposerExtraHeight,
  setComposerExtraHeight,
} from '../zeron/state/uiPrefs';
import type { HarnessDescriptor } from '../zeron/protocol/types';
import { composerAction, harnessSteers, liveAction } from './composerAction';
import type { SendPlan } from '../zeron/attachments/sendPlan';
import type { DictationPort } from '../zeron/native/dictation';
import { QuestionPanel } from './agentsKit/QuestionPanel';
import { VoicePill } from './VoicePill';
import { shouldDismissKeyboardOnSwipe } from '../navigation/keyboardDismissGesture';

// Input grows to ~6 lines on compact width, ~9 lines on iPad (fontSize 17 /
// lineHeight 22 → 22*6+16 = 148, 22*9+16 = 214).
const INPUT_MAX_HEIGHT_COMPACT = 148;
const INPUT_MAX_HEIGHT_REGULAR = 214;
const COMPOSER_EXTRA_MAX = 280;
const COMPOSER_EXTRA_WINDOW_FRAC = 0.4;
const THUMBS_ANIM_MS = 220;
const CHIP_FADE = 28;
const SEND_TARGET = 44;
const TRAILING_GAP = 4;
const TRAILING_RESERVE =
  VOICE_PILL_SIZE + TRAILING_GAP + SEND_TARGET + CHIP_FADE;

function ChipFade({
  width,
  height,
  color,
}: {
  width: number;
  height: number;
  color: string;
}) {
  return (
    <Canvas style={{ width, height }} pointerEvents="none">
      <Rect x={0} y={0} width={width} height={height}>
        <LinearGradient
          start={vec(0, 0)}
          end={vec(width, 0)}
          colors={['transparent', color]}
        />
      </Rect>
    </Canvas>
  );
}

export interface ComposerProps {
  chatId: string;
  /** Session is today's bound-thread composer; compose creates a thread on send. */
  mode?: 'session' | 'compose';
  autoFocus?: boolean;
  phase: RunPhase;
  roomState: RoomState;
  harness?: HarnessDescriptor;
  /** Host capability strings (message-queue-v1 et al). */
  capabilities: ReadonlySet<string>;
  /** Model label only — harness name is replaced by a brand mark. */
  modelLabel: string;
  harnessId?: string;
  recentItems: readonly CatalogModelRef[];
  onPickRecentModel: (harness: string, model: string) => void;
  onOpenMoreModels: () => void;
  effortLabel: string;
  effortSupported: boolean;
  fastSupported: boolean;
  fastEnabled: boolean;
  effortOpen?: boolean;
  onOpenEffort: (origin?: EffortOrigin) => void;
  onToggleFast: (on: boolean) => void;
  onFocusChange?: (focused: boolean) => void;
  checkout?: CheckoutChipsProps;
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
  composerRef?: React.RefObject<View | null>;
  onLayout?: (event: LayoutChangeEvent) => void;
}

export const Composer = React.memo(function ({
  chatId,
  mode = 'session',
  autoFocus = false,
  phase,
  roomState,
  harness,
  capabilities,
  modelLabel,
  harnessId,
  recentItems,
  onPickRecentModel,
  onOpenMoreModels,
  effortLabel,
  effortSupported,
  fastSupported,
  fastEnabled,
  effortOpen = false,
  onOpenEffort,
  onToggleFast,
  onFocusChange,
  checkout,
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
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const persistedExtra = useComposerExtraHeight();
  const [dragExtra, setDragExtra] = useState<number | null>(null);
  const extraHeight = dragExtra ?? persistedExtra;
  const extraRef = useRef(extraHeight);
  extraRef.current = extraHeight;
  const extraStartRef = useRef(0);
  const extraMaxRef = useRef(COMPOSER_EXTRA_MAX);
  extraMaxRef.current = Math.min(
    COMPOSER_EXTRA_MAX,
    Math.round(windowHeight * COMPOSER_EXTRA_WINDOW_FRAC),
  );
  const setDragExtraRef = useRef(setDragExtra);
  setDragExtraRef.current = setDragExtra;
  const focusedRef = useRef(false);
  const effortChipRef = useRef<View>(null);
  const openEffort = useCallback(() => {
    const node = effortChipRef.current;
    if (node !== null && typeof node.measureInWindow === 'function') {
      node.measureInWindow((x, y, width, height) => {
        onOpenEffort({ x, y, width, height });
      });
      return;
    }
    onOpenEffort();
  }, [onOpenEffort]);
  const grabberPan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        extraStartRef.current = extraRef.current;
      },
      onPanResponderMove: (_e, g) => {
        const max = extraMaxRef.current;
        const next = Math.max(0, Math.min(max, extraStartRef.current - g.dy));
        setDragExtraRef.current(next);
      },
      onPanResponderRelease: (_e, g) => {
        const max = extraMaxRef.current;
        const next = Math.max(0, Math.min(max, extraStartRef.current - g.dy));
        setComposerExtraHeight(next);
        setDragExtraRef.current(null);
        if (
          focusedRef.current &&
          extraStartRef.current === 0 &&
          shouldDismissKeyboardOnSwipe(g.dx, g.dy, g.vy)
        ) {
          KeyboardController.dismiss();
        }
      },
    }),
  ).current;
  const inputMaxHeight =
    (windowWidth >= 700 ? INPUT_MAX_HEIGHT_REGULAR : INPUT_MAX_HEIGHT_COMPACT) +
    extraHeight;
  const inputRef = useRef<TextInput>(null);
  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus, mode]);
  const planMode = usePlanMode(chatId);
  const draft = useDraft(chatId);
  const { pickImages, pickCamera, pickFiles } = useAttachments(chatId);
  const [preview, setPreview] = useState<StagedAttachment | null>(null);
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
  const [voiceTick, setVoiceTick] = useState(0);
  const baseRef = useRef('');
  const selRef = useRef(0);
  // Partials/finals splice into the draft at the caret position captured
  // when dictation started (baseRef/selRef) — partials replace each other,
  // the final replaces the last partial.
  const dictationCb = useRef({
    onPartial: (text: string) => {
      setVoiceTick(n => n + 1);
      setDraftText(
        chatId,
        `${baseRef.current.slice(
          0,
          selRef.current,
        )}${text}${baseRef.current.slice(selRef.current)}`,
      );
    },
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
    dictationCb.current.onPartial = text => {
      setVoiceTick(n => n + 1);
      setDraftText(
        chatId,
        `${baseRef.current.slice(
          0,
          selRef.current,
        )}${text}${baseRef.current.slice(selRef.current)}`,
      );
    };
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

  const cancelDictation = useCallback(() => {
    dictation.cancel().catch(() => {});
    setDraftText(chatId, baseRef.current);
    setDictating(false);
  }, [dictation, chatId]);

  const submit = useCallback(() => {
    const text = withPlanPrefixIf(planMode, draft.text.trim());
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
    planMode,
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

  // Reduce Motion: thumbs/strip animate instantly (no swell/shrink).
  const reduceMotion = useReducedMotion();
  const stripH = hasAttachments ? ATTACHMENT_TILE + 8 : 0;
  const stripO = hasAttachments ? 1 : 0;
  const stripDur = reduceMotion ? 0 : THUMBS_ANIM_MS;

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
        style={[
          styles.glassWrap,
          theme.scheme === 'dark'
            ? styles.glassHaloDark
            : styles.glassHaloLight,
        ]}
        onLayout={e =>
          setGlassSize({
            w: e.nativeEvent.layout.width,
            h: e.nativeEvent.layout.height,
          })
        }
      >
        <FadeBlur intensity={22} style={styles.surroundBlur} />
        <Glass style={styles.glass}>
          <View
            style={styles.grabberHit}
            accessibilityRole="adjustable"
            accessibilityLabel={t('composer.resize')}
            {...grabberPan.panHandlers}
          >
            <View
              style={[styles.grabber, { backgroundColor: theme.textSecondary }]}
            />
          </View>
          {mode === 'compose' && checkout !== undefined ? (
            <CheckoutChips {...checkout} />
          ) : null}
          {/* ── Upper tier: attachment strip + input ──────────────────── */}
          <AttachmentStripAnim
            height={stripH}
            opacity={stripO}
            duration={stripDur}
            pointerEvents={hasAttachments ? 'auto' : 'none'}
            style={styles.stripClip}
          >
            <AttachmentStrip
              attachments={draft.attachments}
              onOpen={a => {
                Keyboard.dismiss();
                setPreview(a);
              }}
              onRemove={id => removeAttachment(chatId, id)}
            />
          </AttachmentStripAnim>

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
            ref={inputRef}
            value={draft.text}
            autoFocus={autoFocus}
            onChangeText={text => setDraftText(chatId, text)}
            onSelectionChange={e =>
              (selRef.current = e.nativeEvent.selection.start)
            }
            onFocus={() => {
              focusedRef.current = true;
              onFocusChange?.(true);
            }}
            onBlur={() => {
              focusedRef.current = false;
              onFocusChange?.(false);
            }}
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
              {
                color: theme.text,
                maxHeight: inputMaxHeight,
                minHeight: 60 + extraHeight,
              },
              question !== undefined ? styles.inputDimmed : undefined,
            ]}
            multiline
            accessibilityLabel={t('session.messagePlaceholder')}
            // Cmd+Enter: RN 0.86 onKeyPress exposes key but no modifier
            // flags on iOS — handled in the parent where available; the
            // modifier gap is documented in docs/ARCHITECTURE.md.
          />

          <View style={styles.lowerRow}>
            <View style={styles.leftCluster}>
              <AttachmentMenu
                onPickPhotos={pickImages}
                onPickCamera={pickCamera}
                onPickFiles={pickFiles}
                onEnablePlan={() => setPlanMode(chatId, true)}
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

              <View style={styles.chipsWrap}>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={[
                    styles.actionChips,
                    { paddingRight: TRAILING_RESERVE },
                  ]}
                  style={styles.actionChipsScroll}
                >
                  {planMode ? (
                    <PlanBadge onDismiss={() => setPlanMode(chatId, false)} />
                  ) : null}
                  <ModelMenuButton
                    harnessId={harnessId}
                    modelLabel={modelLabel}
                    items={recentItems}
                    onPick={onPickRecentModel}
                    onMore={onOpenMoreModels}
                  />
                  {effortSupported ? (
                    <Pressable
                      ref={effortChipRef}
                      style={effortOpen ? styles.effortChipHidden : undefined}
                      onPress={openEffort}
                      hitSlop={4}
                      accessibilityRole="button"
                      accessibilityLabel={effortLabel}
                    >
                      <ComposerMenuChip
                        label={effortLabel}
                        color={theme.text}
                        chevronColor={theme.textSecondary}
                      />
                    </Pressable>
                  ) : null}
                  {fastSupported ? (
                    <FastMenuButton
                      enabled={fastEnabled}
                      onToggle={onToggleFast}
                    />
                  ) : null}
                </ScrollView>
                <View style={styles.trailingOverlay} pointerEvents="box-none">
                  <ChipFade
                    width={CHIP_FADE}
                    height={44}
                    color={
                      theme.scheme === 'dark'
                        ? 'rgba(28,28,30,0.88)'
                        : 'rgba(255,255,255,0.88)'
                    }
                  />
                  <View style={styles.trailingCluster}>
                    <VoicePill
                      active={dictating}
                      supported={dictationSupported}
                      levelTick={voiceTick}
                      onToggle={toggleDictation}
                      onCancel={cancelDictation}
                    />
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
                          <ActivityIndicator
                            size="small"
                            color={theme.textSecondary}
                          />
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
                </View>
              </View>
            </View>
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

      {preview !== null && isImageMime(preview.mimeType) ? (
        <ImagePreviewModal
          uri={preview.localUri}
          name={preview.name}
          onDismiss={() => setPreview(null)}
        />
      ) : null}
      {preview !== null && !isImageMime(preview.mimeType) ? (
        <TextFileSheet
          title={preview.name}
          uri={preview.localUri}
          onDismiss={() => setPreview(null)}
        />
      ) : null}
    </View>
  );
});

const CIRCLE = 32;

const styles = StyleSheet.create({
  container: { paddingHorizontal: 12, paddingTop: 8, gap: 8 },
  glassWrap: { position: 'relative' },
  surroundBlur: {
    position: 'absolute',
    top: -64,
    left: -8,
    right: -8,
    bottom: -8,
    overflow: 'hidden',
  },
  glassHaloDark: {
    shadowColor: '#000000',
    shadowOpacity: 0.55,
    shadowRadius: 32,
    shadowOffset: { width: 0, height: 12 },
    elevation: 20,
  },
  glassHaloLight: {
    shadowColor: '#000000',
    shadowOpacity: 0.24,
    shadowRadius: 32,
    shadowOffset: { width: 0, height: 10 },
    elevation: 18,
  },
  grabberHit: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 8,
    paddingBottom: 8,
  },
  grabber: {
    width: 36,
    height: 5,
    borderRadius: 2.5,
    opacity: 0.55,
  },
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
  livePill: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  livePillText: { fontSize: 12, fontWeight: '600' },
  leftCluster: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minWidth: 0,
  },
  chipsWrap: {
    flex: 1,
    minWidth: 0,
    position: 'relative',
    justifyContent: 'center',
  },
  trailingOverlay: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
  },
  trailingCluster: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flexShrink: 0,
  },
  actionChipsScroll: { flexGrow: 1, flexShrink: 1, minWidth: 0 },
  actionChips: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  effortChipHidden: { opacity: 0 },
  hint: { fontSize: 12, textAlign: 'center' },
});
