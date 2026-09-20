// Session composer — one two-tier Liquid Glass container:
//   grabber, then (compose only) Desktop / Project / checkout-mode / Branch,
//   upper tier: attachment strip + always-mounted TextInput (QuestionPanel
//     renders above the lower tier inside the same glass, de-emphasizing —
//     never unmounting — the input),
//   action row: [+] · live Queue/Steer · Plan · model · effort · fast · context · voice · send.
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
import { LinearGradient } from 'expo-linear-gradient';
import MaskedView from '@react-native-masked-view/masked-view';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useReducedMotion } from 'react-native-reanimated';
import {
  KeyboardController,
  useKeyboardState,
} from 'react-native-keyboard-controller';
import * as DropdownMenu from './menus/dropdown-menu';
import { AttachmentMenu } from './AttachmentMenu';
import { AttachmentStrip, ATTACHMENT_TILE } from './AttachmentStrip';
import { ImagePreviewModal } from './ImagePreviewModal';
import { TextFileSheet } from './TextFileSheet';
import { CheckoutChips, type CheckoutChipsProps } from './CheckoutSelector';
import { Glass } from './Glass';
import { Icon } from './Icon';
import { ModelMenuButton } from './ModelMenuButton';
import { FastMenuButton } from './FastMenuButton';
import { ComposerMenuChip } from './ComposerMenuChip';
import { PlanBadge } from './PlanBadge';
import { ContextUsageChip } from './agentsKit/ContextUsage';
import type { EffortOrigin } from './EffortOverlay';
import type { CatalogModelRef } from '../zeron/state/recentModels';
import { withPlanPrefixIf } from './planMode';
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
  setComposerExtraHeightLive,
} from '../zeron/state/uiPrefs';
import {
  clampComposerExtraHeight,
  composerExtraMax,
} from './composerExtraHeight';
import type { HarnessDescriptor, ModelOption } from '../zeron/protocol/types';
import {
  composerAction,
  harnessSteers,
  liveAction,
  queueSupported,
} from './composerAction';
import type { SendPlan } from '../zeron/attachments/sendPlan';
import type { DictationPort } from '../zeron/native/dictation';
import { QuestionPanel } from './agentsKit/QuestionPanel';
import { VoicePill } from './VoicePill';
import {
  VOICE_PILL_PROCESS_MS,
  VOICE_PILL_TRAILING_GAP,
} from './voicePillMath';
import { shouldDismissKeyboardOnSwipe } from '../navigation/keyboardDismissGesture';

// Input grows to ~6 lines on compact width, ~9 lines on iPad (fontSize 17 /
// lineHeight 22 → 22*6+16 = 148, 22*9+16 = 214).
const INPUT_MAX_HEIGHT_COMPACT = 148;
const INPUT_MAX_HEIGHT_REGULAR = 214;
const INPUT_MIN_HEIGHT = 60;
const THUMBS_ANIM_MS = 220;
const CHIP_FADE = 28;

function ChipRowMask({ children }: { children: React.ReactNode }) {
  return (
    <MaskedView
      style={styles.actionChipsScroll}
      maskElement={
        <View style={styles.chipMask}>
          <View style={styles.chipMaskOpaque} />
          <LinearGradient
            colors={['black', 'transparent']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.chipMaskFade}
          />
        </View>
      }
    >
      {children}
    </MaskedView>
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
  fastOption?: ModelOption;
  fastChoice?: string;
  effortOpen?: boolean;
  onOpenEffort: (origin?: EffortOrigin) => void;
  onSelectFast: (choiceId: string) => void;
  onFocusChange?: (focused: boolean) => void;
  checkout?: CheckoutChipsProps;
  dictation: DictationPort;
  onSend: (text: string) => boolean | void | Promise<boolean | void>;
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
  fastOption,
  fastChoice,
  effortOpen = false,
  onOpenEffort,
  onSelectFast,
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
  'use no memo';
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const keyboardVisible = useKeyboardState(s => s.isVisible);
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const extraMax = composerExtraMax(windowHeight);
  const extraHeight = clampComposerExtraHeight(
    useComposerExtraHeight(),
    extraMax,
  );
  const extraRef = useRef(extraHeight);
  extraRef.current = extraHeight;
  const extraStartRef = useRef(0);
  const extraMaxRef = useRef(extraMax);
  extraMaxRef.current = extraMax;
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
        const next = clampComposerExtraHeight(
          extraStartRef.current - g.dy,
          extraMaxRef.current,
        );
        setComposerExtraHeightLive(next);
      },
      onPanResponderRelease: (_e, g) => {
        const next = clampComposerExtraHeight(
          extraStartRef.current - g.dy,
          extraMaxRef.current,
        );
        setComposerExtraHeight(next);
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
  const canQueue = queueSupported(capabilities);
  const action = composerAction(phase, harness, hasText, canQueue);
  const live = liveAction(
    phase,
    canQueue,
    harnessSteers(harness),
    prefersSteer,
  );

  // ── Dictation ─────────────────────────────────────────────────────────
  const [dictationSupported, setDictationSupported] = useState(false);
  const [dictating, setDictating] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [voiceTick, setVoiceTick] = useState(0);
  const baseRef = useRef('');
  const selRef = useRef(0);
  const processingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearProcessingCooldown = useCallback(() => {
    if (processingTimer.current !== null) {
      clearTimeout(processingTimer.current);
      processingTimer.current = null;
    }
    setProcessing(false);
  }, []);
  const beginProcessingCooldown = useCallback(() => {
    if (processingTimer.current !== null) return;
    setProcessing(true);
    processingTimer.current = setTimeout(() => {
      processingTimer.current = null;
      setProcessing(false);
    }, VOICE_PILL_PROCESS_MS);
  }, []);
  const beginProcessingCooldownRef = useRef(beginProcessingCooldown);
  beginProcessingCooldownRef.current = beginProcessingCooldown;
  useEffect(
    () => () => {
      if (processingTimer.current !== null) {
        clearTimeout(processingTimer.current);
        processingTimer.current = null;
      }
    },
    [],
  );
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
      beginProcessingCooldownRef.current();
    },
    onError: () => {
      setDictating(false);
      beginProcessingCooldownRef.current();
    },
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
      beginProcessingCooldownRef.current();
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
    if (processing) return;
    if (dictating) {
      dictation.stop().catch(() => {});
      setDictating(false);
      beginProcessingCooldown();
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
  }, [dictating, dictation, draft.text, processing, beginProcessingCooldown]);

  const cancelDictation = useCallback(() => {
    dictation.cancel().catch(() => {});
    setDraftText(chatId, baseRef.current);
    setDictating(false);
    clearProcessingCooldown();
  }, [dictation, chatId, clearProcessingCooldown]);

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
    if (action.primary === 'steer') {
      onSteer(text);
      setDraftText(chatId, '');
      return;
    }
    if (action.primary !== 'send') return;
    const result = onSend(text);
    const finish = (ok: boolean | void) => {
      if (ok !== false) setDraftText(chatId, '');
    };
    if (
      typeof result === 'object' &&
      result !== null &&
      typeof (result as Promise<boolean | void>).then === 'function'
    ) {
      (result as Promise<boolean | void>).then(finish, () => {});
      return;
    }
    finish(result as boolean | void);
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
  const sendArmed =
    right === 'send' &&
    (action.primary === 'send' || live === 'queue' || live === 'steer');
  const coverSend = dictating || processing;
  const homeInset = (keyboardVisible ? 0 : insets.bottom) + 8;

  // Beam geometry = the glass's own bounds; Reduce Motion collapses the
  // sweep to a static ring.
  const [glassSize, setGlassSize] = useState({ w: 0, h: 0 });

  return (
    <View ref={composerRef} onLayout={onLayout} style={styles.container}>
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

          {/* minHeight spacer: layout grows by extraHeight 1:1, independent
            of iOS multiline TextInput intrinsic size. Text can still fill
            the extra via maxHeight. */}
          <View style={{ minHeight: INPUT_MIN_HEIGHT + extraHeight }}>
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
                },
                question !== undefined ? styles.inputDimmed : undefined,
              ]}
              multiline
              accessibilityLabel={t('session.messagePlaceholder')}
              // Cmd+Enter: RN 0.86 onKeyPress exposes key but no modifier
              // flags on iOS — handled in the parent where available; the
              // modifier gap is documented in docs/ARCHITECTURE.md.
            />
          </View>

          <View style={styles.lowerRow}>
            <View style={styles.leftCluster}>
              <AttachmentMenu
                onPickPhotos={pickImages}
                onPickCamera={pickCamera}
                onPickFiles={pickFiles}
                planEnabled={planMode}
                onTogglePlan={on => setPlanMode(chatId, on)}
              />

              {showLivePill ? (
                <DropdownMenu.Root>
                  <DropdownMenu.Trigger>
                    <Pressable
                      hitSlop={4}
                      accessibilityRole="button"
                      accessibilityLabel={
                        live === 'queue'
                          ? t('session.queue')
                          : t('session.steer')
                      }
                    >
                      <ComposerMenuChip
                        label={
                          live === 'queue'
                            ? t('session.queue')
                            : t('session.steer')
                        }
                        color={theme.text}
                        chevronColor={theme.textSecondary}
                      />
                    </Pressable>
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
                <ChipRowMask>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.actionChips}
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
                        option={fastOption}
                        value={fastChoice}
                        onSelect={onSelectFast}
                      />
                    ) : null}
                    <View style={styles.chipSpacer} />
                    <ContextUsageChip usage={session.meta.contextUsage} />
                  </ScrollView>
                </ChipRowMask>
                <View style={styles.trailingCluster} collapsable={false}>
                  <VoicePill
                    active={dictating}
                    supported={dictationSupported}
                    processing={processing}
                    levelTick={voiceTick}
                    onToggle={toggleDictation}
                    onCancel={cancelDictation}
                  />
                  <Pressable
                    onPress={
                      coverSend
                        ? undefined
                        : right === 'stop'
                        ? onStop
                        : right === 'cancel'
                        ? onCancel
                        : right === 'send'
                        ? submit
                        : undefined
                    }
                    disabled={
                      coverSend ||
                      right === 'stopping' ||
                      (right === 'send' && !sendArmed)
                    }
                    pointerEvents={coverSend ? 'none' : 'auto'}
                    accessibilityElementsHidden={coverSend}
                    importantForAccessibility={
                      coverSend ? 'no-hide-descendants' : 'auto'
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
                        coverSend ||
                        right === 'stopping' ||
                        (right === 'send' && !sendArmed),
                      busy: right === 'stopping',
                    }}
                    style={styles.minTarget}
                  >
                    <View
                      style={[
                        styles.circle,
                        {
                          backgroundColor:
                            right === 'send' && !sendArmed
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
                            right === 'send' && !sendArmed
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

      <View
        style={[styles.homePad, { height: homeInset }]}
        pointerEvents="none"
      />

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
    minHeight: INPUT_MIN_HEIGHT,
    textAlignVertical: 'top',
  },
  inputDimmed: { opacity: 0.45 },
  stripClip: { overflow: 'hidden' },
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
    flexDirection: 'row',
    alignItems: 'center',
  },
  chipMask: {
    flex: 1,
    flexDirection: 'row',
  },
  chipMaskOpaque: { flex: 1, backgroundColor: 'black' },
  chipMaskFade: { width: CHIP_FADE, height: '100%' },
  trailingCluster: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: VOICE_PILL_TRAILING_GAP,
    flexShrink: 0,
    height: 44,
    overflow: 'visible',
  },
  actionChipsScroll: { flexGrow: 1, flexShrink: 1, minWidth: 0 },
  actionChips: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexGrow: 1,
    paddingRight: CHIP_FADE,
  },
  chipSpacer: { flexGrow: 1, minWidth: 0 },
  effortChipHidden: { opacity: 0 },
  hint: { fontSize: 12, textAlign: 'center' },
  homePad: {},
});
