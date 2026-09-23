// Session composer — one two-tier Liquid Glass container:
//   grabber, then (compose only) Desktop / Project / checkout-mode / Branch,
//   upper tier: attachment strip + always-mounted TextInput (QuestionPanel
//     renders above the lower tier inside the same glass, de-emphasizing —
//     never unmounting — the input),
//   action row: [+] · live Queue/Steer · Plan · model · effort · fast · context window · usage · voice · send.
// Host / repo / origin live on the thread Details sheet for existing sessions.
// All decisions route through composerAction/liveAction + the draftStore;
// attachment sends go through onSendAttachments (queued `pending://` flow or
// legacy upload-first — never a device-local URI on the wire).

import React, {
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Alert,
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
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import { KeyboardController } from 'react-native-keyboard-controller';
import * as DropdownMenu from './menus/dropdown-menu';
import { AttachmentMenu } from './AttachmentMenu';
import { AttachmentStrip, ATTACHMENT_TILE } from './AttachmentStrip';
import { ImagePreviewModal } from './ImagePreviewModal';
import { TextFileSheet } from './TextFileSheet';
import { CheckoutChips, type CheckoutChipsProps } from './CheckoutSelector';
import { Glass } from './Glass';
import { Icon } from './Icon';
import { ModelMenuButton } from './ModelMenuButton';
import { ContextWindowButton } from './ContextWindowButton';
import { FastMenuButton } from './FastMenuButton';
import { ComposerMenuChip } from './ComposerMenuChip';
import { PlanBadge } from './PlanBadge';
import { ContextUsageChip } from './agentsKit/ContextUsage';
import type { EffortOrigin } from './EffortOverlay';
import type { CatalogModelRef } from '../zeron/state/recentModels';
import { withPlanPrefixIf } from './planMode';
import { stagePastedText, useAttachments } from '../hooks/useAttachments';
import {
  PASTE_FILE_THRESHOLD,
  splitTextEdit,
} from '../zeron/attachments/paste';
import { isImageMime } from '../zeron/attachments/validate';
import { useChromeTheme } from '../chromeTheme';
import { t } from '../i18n/strings';
import { AppServicesContext } from '../app/runtimeContext';
import { METHODS } from '../zeron/protocol/rpc';
import { EngineCapability } from '../zeron/protocol/types';
import type { FileSearchMatch, SlashCommand } from '../zeron/protocol/types';
import {
  localFileLink,
  localPathIsSafe,
  type Skill,
} from '../zeron/protocol/references';
import {
  completionTrigger,
  filterIndices,
  invocationInsertion,
  mentionErrorMessage,
  mentionToken,
  menuStep,
  removeCompletionToken,
  replaceCompletionToken,
  referencesRequireUpdate,
  skillDisplayName,
  skillPrefsForHarness,
  slashErrorMessage,
  mergeInvocationResults,
  withWorkspaceCommands,
  workspaceCommandForText,
  type CompletionToken,
  type InvocationCandidate,
  type WorkspaceCommand,
} from '../zeron/composer/completion';
import {
  ComposerAutocomplete,
  type CompletionRowData,
} from './ComposerAutocomplete';
import { useDeviceOnline } from '../zeron/state/workspaceStore';
import {
  clearDraft,
  removeAttachment,
  setDraftText,
  useDraft,
  type StagedAttachment,
} from '../zeron/state/draftStore';
import {
  markQuestionAnswered,
  useOpenQuestion,
  useContextUsage,
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
  useCleanupPromptOverride,
  useVoiceInputMode,
} from '../zeron/state/uiPrefs';
import {
  beginComposerResize,
  clampComposerExtraHeight,
  composerExtraMax,
  endComposerResize,
} from './composerExtraHeight';
import type { HarnessDescriptor, ModelOption } from '../zeron/protocol/types';
import type { OpenQuestion } from '../zeron/protocol/detectQuestion';
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
import {
  isVoiceBusy,
  isVoiceProcessing,
  LocalVoiceSession,
  restoreVoiceRange,
  type LocalVoiceRuntime,
  type VoiceNotice,
  type VoicePipelineStage,
} from '../zeron/voice';
import { DEFAULT_CLEANUP_PROMPT } from '../zeron/voice/prompt';

// Input grows to ~6 lines on compact width, ~9 lines on iPad (fontSize 17 /
// lineHeight 22 → 22*6+16 = 148, 22*9+16 = 214).
const INPUT_MAX_HEIGHT_COMPACT = 148;
const INPUT_MAX_HEIGHT_REGULAR = 214;
const INPUT_MIN_HEIGHT = 60;
const THUMBS_ANIM_MS = 220;
const CHIP_FADE = 28;
const VOICE_NOTICE_TIMEOUT_MS = 20_000;
const VOICE_NOTICE_FADE_MS = 800;

const sameToken = (
  a: CompletionToken | undefined,
  b: CompletionToken | undefined,
) =>
  a === b ||
  (a !== undefined &&
    b !== undefined &&
    a.start === b.start &&
    a.end === b.end &&
    a.query === b.query);

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
  contextSupported?: boolean;
  contextOption?: ModelOption;
  contextChoice?: string;
  effortOpen?: boolean;
  onOpenEffort: (origin?: EffortOrigin) => void;
  onSelectFast: (choiceId: string) => void;
  onSelectContext?: (choiceId: string) => void;
  onFocusChange?: (focused: boolean) => void;
  checkout?: CheckoutChipsProps;
  dictation: DictationPort;
  voiceRuntime?: LocalVoiceRuntime;
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
  /** App-detected questions (unresolved question tool calls, trailing prose
   * questions) — no host request id, so answers ship as a steer. Optional:
   * compose mode has no session store and never produces a question. */
  onAnswerQuestion?: (
    question: OpenQuestion,
    answers: { questionId: string; labels: string[] }[],
  ) => void;
  /** The send was refused (e.g. attachments while live without queue
   * support) — the parent surfaces it; nothing is silently dropped. */
  onSendBlocked: () => void;
  composerRef?: React.RefObject<View | null>;
  onLayout?: (event: LayoutChangeEvent) => void;
  /**
   * Completion target: which device/workspace `/`, `$`, `@` lookups hit.
   * Absent → completion still lists Zeron's workspace commands (plain text
   * inserts only where they apply) but never calls the relay.
   */
  completion?: {
    deviceId?: string;
    chatId?: string;
    spaceId?: string;
    cwd?: string;
  };
  /** Workspace-command rows (`/files`, `/terminal`, …) resolve to this action. */
  onWorkspaceCommand?: (command: WorkspaceCommand) => void;
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
  contextSupported = false,
  contextOption,
  contextChoice,
  effortOpen = false,
  onOpenEffort,
  onSelectFast,
  onSelectContext,
  onFocusChange,
  checkout,
  dictation,
  voiceRuntime,
  onSend,
  onSteer,
  onQueue,
  onStop,
  onCancel,
  onSendAttachments,
  onRespondInput,
  onAnswerQuestion = () => {},
  onSendBlocked,
  composerRef,
  onLayout,
  completion,
  onWorkspaceCommand,
}: ComposerProps) {
  'use no memo';
  const theme = useChromeTheme();
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const extraMax = composerExtraMax(windowHeight);
  const extraHeight = clampComposerExtraHeight(
    useComposerExtraHeight(),
    extraMax,
  );
  const question = useOpenQuestion(chatId);
  // An open question owns the composer surface: drop the user's extra height
  // to its minimum and hide the resize grabber so the panel stays on screen.
  // The stored value is untouched, so both return once the question closes.
  const effectiveExtra = question !== undefined ? 0 : extraHeight;
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
        beginComposerResize();
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
        endComposerResize();
        if (
          focusedRef.current &&
          extraStartRef.current === 0 &&
          shouldDismissKeyboardOnSwipe(g.dx, g.dy, g.vy)
        ) {
          KeyboardController.dismiss();
        }
      },
      onPanResponderTerminate: () => {
        setComposerExtraHeight(extraRef.current);
        endComposerResize();
      },
    }),
  ).current;
  const inputMaxHeight =
    (windowWidth >= 700 ? INPUT_MAX_HEIGHT_REGULAR : INPUT_MAX_HEIGHT_COMPACT) +
    effectiveExtra;
  const inputRef = useRef<TextInput>(null);
  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus, mode]);
  const planMode = usePlanMode(chatId);
  const draft = useDraft(chatId);
  const { pickImages, pickCamera, pickFiles } = useAttachments(chatId);
  const [preview, setPreview] = useState<StagedAttachment | null>(null);
  const contextUsage = useContextUsage(chatId);
  const prefersSteer = useLiveActionPrefersSteer();
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

  // ── Voice input (Dictation or local Voice Model) ──────────────────────
  const voiceInputMode = useVoiceInputMode();
  const cleanupPromptOverride = useCleanupPromptOverride();
  const [dictationSupported, setDictationSupported] = useState(false);
  const [dictating, setDictating] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [voiceTick, setVoiceTick] = useState(0);
  const [voiceStage, setVoiceStage] = useState<VoicePipelineStage>('idle');
  const [voiceNotice, setVoiceNotice] = useState<VoiceNotice | null>(null);
  const baseRef = useRef('');
  const selRef = useRef(0);
  const selEndRef = useRef(0);
  const draftTextRef = useRef(draft.text);
  draftTextRef.current = draft.text;
  const chatIdRef = useRef(chatId);
  chatIdRef.current = chatId;

  // ── Completion (/, $, @) — desktop composer.rs slash/mention parity ────
  const services = useContext(AppServicesContext);
  const runtime = services?.runtime ?? null;
  const completionDevice = completion?.deviceId;
  const completionOnline = useDeviceOnline(completionDevice ?? '');
  const refsSupported = capabilities.has(EngineCapability.composerReferencesV1);
  const inChat = mode === 'session';
  const [sendError, setSendError] = useState<string | null>(null);

  const slashCacheRef = useRef(new Map<string, InvocationCandidate[]>());
  const slashMetaRef = useRef({
    request: 0,
    loading: false,
    context: '',
    catalogContext: '',
    supported: true,
    skill: false,
    token: undefined as CompletionToken | undefined,
    error: undefined as string | undefined,
    dismissed: undefined as
      | { start: number; end: number; text: string }
      | undefined,
  });
  const [slashUI, setSlashUI] = useState<{
    token: CompletionToken;
    skill: boolean;
    rows: InvocationCandidate[];
    filtered: number[];
    active: number | undefined;
    loading: boolean;
    error: string | undefined;
    context: string;
  } | null>(null);
  const mentionMetaRef = useRef({
    request: 0,
    context: '',
    token: undefined as CompletionToken | undefined,
    results: [] as FileSearchMatch[],
    active: undefined as number | undefined,
    loading: false,
    error: undefined as string | undefined,
    dismissed: undefined as
      | { start: number; end: number; text: string }
      | undefined,
  });
  const [mentionUI, setMentionUI] = useState<{
    token: CompletionToken;
    results: FileSearchMatch[];
    active: number | undefined;
    loading: boolean;
    error: string | undefined;
  } | null>(null);
  const mentionDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Enter/Tab with an open menu: onKeyPress flags the caret, handleChangeText
  // strips the '\n'/'\t' RN inserts anyway, then accepts the row.
  const acceptAtRef = useRef<number | null>(null);

  const publishSlash = useCallback(() => {
    const meta = slashMetaRef.current;
    const token = meta.token;
    if (token === undefined) {
      setSlashUI(null);
      return;
    }
    const rows = slashCacheRef.current.get(meta.context) ?? [];
    const filtered = filterIndices(
      token.query,
      rows.map(r => r.name),
    );
    setSlashUI({
      token,
      skill: meta.skill,
      rows,
      filtered,
      active: filtered.length > 0 ? 0 : undefined,
      loading: meta.loading,
      error: meta.error,
      context: meta.context,
    });
  }, []);

  const resetSlash = useCallback(
    (dismissed?: { start: number; end: number; text: string }) => {
      const meta = slashMetaRef.current;
      if (meta.error !== undefined) slashCacheRef.current.delete(meta.context);
      meta.request += 1;
      meta.loading = false;
      meta.token = undefined;
      meta.dismissed = dismissed;
      setSlashUI(null);
    },
    [],
  );

  const publishMention = useCallback(() => {
    const m = mentionMetaRef.current;
    setMentionUI(
      m.token === undefined
        ? null
        : {
            token: m.token,
            results: m.results,
            active: m.active,
            loading: m.loading,
            error: m.error,
          },
    );
  }, []);

  const resetMention = useCallback(
    (dismissed?: { start: number; end: number; text: string }) => {
      if (mentionDebounceRef.current !== null) {
        clearTimeout(mentionDebounceRef.current);
        mentionDebounceRef.current = null;
      }
      const m = mentionMetaRef.current;
      m.request += 1;
      m.token = undefined;
      m.results = [];
      m.active = undefined;
      m.loading = false;
      m.error = undefined;
      m.dismissed = dismissed;
      setMentionUI(null);
    },
    [],
  );

  const catalogParams = useCallback((): Record<string, unknown> => {
    const params: Record<string, unknown> = { harness: harnessId ?? null };
    if (completion?.chatId !== undefined) {
      params.chatId = completion.chatId;
      params.targetDeviceId = completion.deviceId;
      params.cwd = completion.cwd ?? null;
    } else if (completion?.spaceId !== undefined) {
      params.spaceId = completion.spaceId;
      params.targetDeviceId = completion.deviceId;
      params.cwd = completion.cwd ?? null;
    } else if (completion?.deviceId !== undefined) {
      params.targetDeviceId = completion.deviceId;
    }
    return params;
  }, [
    completion?.chatId,
    completion?.deviceId,
    completion?.cwd,
    completion?.spaceId,
    harnessId,
  ]);

  const fileSearchParams = useCallback(
    (query: string): Record<string, unknown> | undefined => {
      if (completion?.deviceId === undefined || completion.deviceId === '')
        return undefined;
      const params: Record<string, unknown> = { query };
      if (completion.chatId !== undefined) {
        params.chatId = completion.chatId;
        params.cwd = completion.cwd ?? null;
      } else if (completion.spaceId !== undefined) {
        params.spaceId = completion.spaceId;
        params.cwd = completion.cwd ?? null;
      } else {
        return undefined;
      }
      params.targetDeviceId = completion.deviceId;
      return params;
    },
    [
      completion?.chatId,
      completion?.deviceId,
      completion?.cwd,
      completion?.spaceId,
    ],
  );

  const connectionKey = useCallback(
    () =>
      `${runtime === null ? 0 : 1}:${
        completionDevice ?? ''
      }:${completionOnline}`,
    [runtime, completionDevice, completionOnline],
  );

  const applyCompletionEdit = useCallback(
    (text: string, cursor: number) => {
      setDraftText(chatId, text);
      selRef.current = cursor;
      selEndRef.current = cursor;
      // The controlled value lands first; move the native caret after it.
      setTimeout(() => inputRef.current?.setSelection(cursor, cursor), 0);
    },
    [chatId],
  );

  const acceptSlash = useCallback(
    (index?: number) => {
      const meta = slashMetaRef.current;
      const token = meta.token;
      if (token === undefined) return;
      const active = index ?? slashUI?.active;
      if (active === undefined || slashUI === null) return;
      const row = slashUI.rows[slashUI.filtered[active]];
      if (row === undefined) return;
      if (row.workspaceCommand !== undefined) {
        resetSlash();
        setDraftText(
          chatId,
          removeCompletionToken(draftTextRef.current, token),
        );
        onWorkspaceCommand?.(row.workspaceCommand);
        return;
      }
      const insertion = invocationInsertion(row.invocation, refsSupported);
      const next = replaceCompletionToken(
        draftTextRef.current,
        token,
        insertion,
      );
      resetSlash();
      applyCompletionEdit(next.text, next.cursor);
    },
    [
      slashUI,
      chatId,
      refsSupported,
      onWorkspaceCommand,
      resetSlash,
      applyCompletionEdit,
    ],
  );

  const acceptMention = useCallback(
    (index?: number) => {
      const m = mentionMetaRef.current;
      const token = m.token;
      if (token === undefined) return;
      const active = index ?? m.active;
      if (active === undefined) return;
      const row = m.results[active];
      if (row === undefined) return;
      const next = replaceCompletionToken(
        draftTextRef.current,
        token,
        localFileLink(row.path, row.isDir),
      );
      resetMention();
      applyCompletionEdit(next.text, next.cursor);
    },
    [resetMention, applyCompletionEdit],
  );

  const acceptCompletion = useCallback(() => {
    if (slashMetaRef.current.token !== undefined) acceptSlash();
    else acceptMention();
  }, [acceptSlash, acceptMention]);

  const dismissCompletion = useCallback(() => {
    const slashTokenNow = slashMetaRef.current.token;
    if (slashTokenNow !== undefined) {
      resetSlash({
        start: slashTokenNow.start,
        end: slashTokenNow.end,
        text: draftTextRef.current.slice(
          slashTokenNow.start,
          slashTokenNow.end,
        ),
      });
      return;
    }
    const mtok = mentionMetaRef.current.token;
    if (mtok !== undefined)
      resetMention({
        start: mtok.start,
        end: mtok.end,
        text: draftTextRef.current.slice(mtok.start, mtok.end),
      });
  }, [resetSlash, resetMention]);

  const navigateCompletion = useCallback(
    (delta: number) => {
      if (slashUI !== null) {
        const active = menuStep(slashUI.active, slashUI.filtered.length, delta);
        setSlashUI(s => (s === null ? s : { ...s, active }));
        return;
      }
      const m = mentionMetaRef.current;
      if (m.token !== undefined) {
        m.active = menuStep(m.active, m.results.length, delta);
        publishMention();
      }
    },
    [slashUI, publishMention],
  );

  /** Recompute both completions for the current text+caret. */
  const syncCompletion = useCallback(
    (text: string, cursor: number) => {
      if (completion === undefined) {
        if (slashMetaRef.current.token !== undefined) resetSlash();
        if (mentionMetaRef.current.token !== undefined) resetMention();
        return;
      }
      const prefs = skillPrefsForHarness(harnessId);
      const trig = completionTrigger(text, cursor, prefs);
      const connKey = connectionKey();
      const params = catalogParams();
      const catalogContext = `${prefs.dollar}:${
        prefs.separateFromSlash
      }:${connKey}:${JSON.stringify(params)}`;
      const context = `${trig.skill ? 'skill' : 'command'}:${
        trig.includeSkills
      }:${trig.commandsAllowed}:${catalogContext}`;
      const meta = slashMetaRef.current;
      const token = trig.token;

      if (token === undefined) {
        resetSlash();
      } else {
        const contextChanged = meta.context !== context;
        const dismissed =
          !contextChanged &&
          meta.dismissed !== undefined &&
          token.start === meta.dismissed.start &&
          token.end === meta.dismissed.end &&
          text.slice(token.start, token.end) === meta.dismissed.text;
        if (dismissed) {
          meta.token = undefined;
          setSlashUI(null);
        } else if (!contextChanged && sameToken(meta.token, token)) {
          // Token unchanged — keep the current list/selection as is.
        } else {
          const refresh = contextChanged || meta.token === undefined;
          meta.dismissed = undefined;
          if (contextChanged) {
            meta.request += 1;
            meta.loading = false;
            if (meta.catalogContext !== catalogContext)
              slashCacheRef.current.clear();
            else if (meta.error !== undefined || !meta.supported)
              slashCacheRef.current.delete(meta.context);
            meta.catalogContext = catalogContext;
            meta.context = context;
            meta.skill = trig.skill;
            meta.supported = true;
            meta.error = undefined;
          }
          meta.token = token;
          const deviceId = completion.deviceId;
          const relay =
            runtime !== null && deviceId !== undefined && deviceId !== ''
              ? runtime.relayFor(deviceId)
              : undefined;
          if (harnessId === undefined && !trig.skill && trig.commandsAllowed)
            slashCacheRef.current.set(
              context,
              withWorkspaceCommands([], inChat),
            );
          if (
            harnessId === undefined ||
            (slashCacheRef.current.has(context) && !refresh) ||
            meta.loading
          ) {
            publishSlash();
          } else if (relay === undefined) {
            if (!trig.skill && trig.commandsAllowed) {
              slashCacheRef.current.set(
                context,
                withWorkspaceCommands([], inChat),
              );
              meta.error = t('composer.autocomplete.noConnection');
            }
            publishSlash();
          } else {
            meta.request += 1;
            const request = meta.request;
            meta.loading = true;
            meta.error = undefined;
            publishSlash();
            const callParams = params;
            const listCommands: Promise<SlashCommand[]> =
              trig.skill || !trig.commandsAllowed
                ? Promise.resolve([])
                : relay.call<SlashCommand[]>(METHODS.LIST_COMMANDS, callParams);
            const listSkills = relay.call<Skill[] | null>(
              METHODS.LIST_SKILLS,
              callParams,
            );
            Promise.allSettled([listCommands, listSkills]).then(settled => {
              const m = slashMetaRef.current;
              if (m.request !== request || m.context !== context) return;
              m.loading = false;
              const commands =
                settled[0].status === 'fulfilled'
                  ? settled[0].value
                  : settled[0].reason;
              const skills =
                settled[1].status === 'fulfilled'
                  ? settled[1].value ?? undefined
                  : settled[1].reason;
              const merged = mergeInvocationResults(
                commands,
                skills,
                trig.skill,
              );
              if (merged instanceof Error) {
                slashCacheRef.current.delete(context);
                m.error = slashErrorMessage(merged, trig.skill);
                if (!trig.skill && trig.commandsAllowed)
                  slashCacheRef.current.set(
                    context,
                    withWorkspaceCommands([], inChat),
                  );
              } else {
                m.supported = merged.supported;
                m.error = merged.warning;
                let rows = merged.candidates;
                if (!trig.includeSkills)
                  rows = rows.filter(r => r.invocation.kind === 'command');
                if (!trig.skill && trig.commandsAllowed)
                  rows = withWorkspaceCommands(rows, inChat);
                slashCacheRef.current.set(context, rows);
              }
              publishSlash();
            });
          }
        }
      }

      // ── @ file mentions (independent trigger) ──────────────────────────
      const m = mentionMetaRef.current;
      const fileParams = fileSearchParams('');
      const mContext =
        fileParams === undefined
          ? ''
          : `${connKey}:${JSON.stringify(fileParams)}`;
      if (m.context !== mContext) {
        resetMention();
        m.context = mContext;
      }
      const mtok = mentionToken(text, cursor);
      const stillDismissed =
        mtok !== undefined &&
        m.dismissed !== undefined &&
        mtok.start === m.dismissed.start &&
        mtok.end === m.dismissed.end &&
        text.slice(mtok.start, mtok.end) === m.dismissed.text;
      if (stillDismissed) {
        m.token = undefined;
        setMentionUI(null);
      } else if (!sameToken(m.token, mtok)) {
        m.dismissed = undefined;
        m.request += 1;
        const request = m.request;
        const refining = m.token !== undefined && mtok !== undefined;
        m.token = mtok;
        if (!refining) {
          m.results = [];
          m.active = undefined;
        }
        m.error = undefined;
        m.loading = mtok !== undefined;
        publishMention();
        if (mtok === undefined) return;
        const searchParams = fileSearchParams(mtok.query);
        const deviceId = completion.deviceId;
        if (
          runtime === null ||
          searchParams === undefined ||
          deviceId === undefined ||
          deviceId === ''
        ) {
          m.loading = false;
          publishMention();
          return;
        }
        if (mentionDebounceRef.current !== null)
          clearTimeout(mentionDebounceRef.current);
        mentionDebounceRef.current = setTimeout(() => {
          const relay = runtime.relayFor(deviceId);
          const call = (): Promise<FileSearchMatch[]> =>
            relay.call<FileSearchMatch[]>(METHODS.SEARCH_FILES, searchParams);
          call()
            .catch(err => {
              // One retry rides out a cold relay dial (desktop parity).
              const unreachable =
                err instanceof Error &&
                'kind' in err &&
                (err.kind === 'notConnected' || err.kind === 'hostOffline');
              if (!unreachable) throw err;
              return new Promise<FileSearchMatch[]>((resolve, reject) =>
                setTimeout(() => call().then(resolve, reject), 250),
              );
            })
            .then(results => {
              const mm = mentionMetaRef.current;
              if (mm.request !== request || mm.token === undefined) return;
              mm.loading = false;
              mm.error = undefined;
              mm.results = results.filter(r => localPathIsSafe(r.path));
              mm.active = mm.results.length > 0 ? 0 : undefined;
              publishMention();
            })
            .catch(err => {
              const mm = mentionMetaRef.current;
              if (mm.request !== request || mm.token === undefined) return;
              mm.loading = false;
              mm.results = [];
              mm.active = undefined;
              mm.error = mentionErrorMessage(err);
              publishMention();
            });
        }, 80);
      }
    },
    [
      completion,
      runtime,
      harnessId,
      inChat,
      connectionKey,
      catalogParams,
      fileSearchParams,
      resetSlash,
      resetMention,
      publishSlash,
      publishMention,
    ],
  );

  // Re-run on every draft edit; caret moves are handled in onSelectionChange.
  const completionContextKey = `${connectionKey()}:${JSON.stringify(
    catalogParams(),
  )}:${JSON.stringify(fileSearchParams(''))}`;
  useEffect(() => {
    syncCompletion(draft.text, selRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.text, runtime, completionContextKey]);
  useEffect(
    () => () => {
      if (mentionDebounceRef.current !== null)
        clearTimeout(mentionDebounceRef.current);
    },
    [],
  );
  const voiceSessionRef = useRef<LocalVoiceSession | null>(null);
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
    if (voiceInputMode !== 'dictation') {
      setDictationSupported(false);
      return;
    }
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
  }, [dictation, voiceInputMode]);

  useEffect(() => {
    if (voiceInputMode !== 'voiceModel') {
      voiceSessionRef.current?.invalidate();
      voiceSessionRef.current = null;
      setVoiceStage('idle');
      return;
    }
    const voiceSession = new LocalVoiceSession({
      chatId,
      getDraft: () => draftTextRef.current,
      setDraft: text => setDraftText(chatIdRef.current, text),
      getSelection: () => selRef.current,
      capture: voiceRuntime?.capture ?? {
        start: () => Promise.reject(new Error('unavailable')),
        stop: () => Promise.reject(new Error('unavailable')),
        cancel: () => Promise.resolve(),
      },
      transcription: voiceRuntime?.transcription ?? {
        isAvailable: () => Promise.resolve(false),
        transcribe: () => Promise.reject(new Error('unavailable')),
        unload: () => Promise.resolve(),
        abort: () => Promise.resolve(),
      },
      cleanup: voiceRuntime?.cleanup,
      transcriptionPath: voiceRuntime?.transcriptionPath ?? '',
      cleanupPath: voiceRuntime?.cleanupPath,
      cleanupPrompt: cleanupPromptOverride ?? DEFAULT_CLEANUP_PROMPT,
      onStage: setVoiceStage,
      onNotice: setVoiceNotice,
      deleteAudio: voiceRuntime?.deleteAudio,
    });
    voiceSessionRef.current = voiceSession;
    return () => voiceSession.invalidate();
  }, [chatId, voiceInputMode, voiceRuntime, cleanupPromptOverride]);

  useEffect(() => {
    setVoiceNotice(null);
  }, [chatId, voiceInputMode]);

  // Voice notices are transient: fade then clear them so a stale
  // "Kept original voice text" / "Restore Original Voice Text" prompt
  // never lingers. A new notice re-arms the timer.
  const reduceMotion = useReducedMotion();
  const noticeOpacity = useSharedValue(1);
  const noticeAnimStyle = useAnimatedStyle(() => ({
    opacity: noticeOpacity.value,
  }));
  useEffect(() => {
    if (voiceNotice === null) return;
    noticeOpacity.value = 1;
    if (!reduceMotion) {
      noticeOpacity.value = withDelay(
        VOICE_NOTICE_TIMEOUT_MS - VOICE_NOTICE_FADE_MS,
        withTiming(0, { duration: VOICE_NOTICE_FADE_MS }),
      );
    }
    const timer = setTimeout(
      () => setVoiceNotice(null),
      VOICE_NOTICE_TIMEOUT_MS,
    );
    return () => clearTimeout(timer);
  }, [voiceNotice, noticeOpacity, reduceMotion]);

  // Stop capture on background / unmount (never leak the mic).
  useEffect(() => {
    const sub = AppState.addEventListener('change', s => {
      if (s !== 'active' && dictating) {
        dictation.stop().catch(() => {});
        setDictating(false);
      }
      if (s !== 'active' && voiceInputMode === 'voiceModel') {
        voiceSessionRef.current?.invalidate();
      }
    });
    return () => {
      sub.remove();
      if (dictating) dictation.stop().catch(() => {});
      voiceSessionRef.current?.invalidate();
    };
  }, [dictation, dictating, voiceInputMode]);

  const localVoiceBusy =
    voiceInputMode === 'voiceModel' && isVoiceBusy(voiceStage);
  const localVoiceProcessing =
    voiceInputMode === 'voiceModel' && isVoiceProcessing(voiceStage);

  const toggleDictation = useCallback(() => {
    if (voiceInputMode === 'voiceModel') {
      const localSession = voiceSessionRef.current;
      if (localSession === null) return;
      if (voiceStage === 'recording') {
        localSession.stop().catch(() => {});
        return;
      }
      if (isVoiceProcessing(voiceStage)) {
        localSession.cancelProcessing().catch(() => {});
        return;
      }
      localSession.start().then(result => {
        if (result === 'missingModel') {
          Alert.alert(
            t('composer.voiceMissingModelTitle'),
            t('composer.voiceMissingModel'),
          );
        }
      });
      return;
    }
    if (processing) return;
    if (dictating) {
      dictation.stop().catch(() => {});
      setDictating(false);
      beginProcessingCooldown();
      return;
    }
    baseRef.current = draft.text;
    selRef.current = focusedRef.current
      ? Math.min(selRef.current, draft.text.length)
      : draft.text.length;
    dictation
      .start(
        { locale: uiPrefsStore.getState().dictationLocale },
        dictationCb.current,
      )
      .then(() => setDictating(true))
      .catch(() => setDictating(false));
  }, [
    dictating,
    dictation,
    draft.text,
    processing,
    beginProcessingCooldown,
    voiceInputMode,
    voiceStage,
  ]);

  const cancelDictation = useCallback(() => {
    if (voiceInputMode === 'voiceModel') {
      voiceSessionRef.current?.cancelRecording().catch(() => {});
      return;
    }
    dictation.cancel().catch(() => {});
    setDraftText(chatId, baseRef.current);
    setDictating(false);
    clearProcessingCooldown();
  }, [dictation, chatId, clearProcessingCooldown, voiceInputMode]);

  const restoreVoiceText = useCallback(() => {
    if (voiceNotice?.kind !== 'restore') return;
    if (
      voiceNotice.raw === undefined ||
      voiceNotice.cleaned === undefined ||
      voiceNotice.start === undefined ||
      voiceNotice.end === undefined
    ) {
      setVoiceNotice(null);
      return;
    }
    const next = restoreVoiceRange(
      draftTextRef.current,
      voiceNotice.start,
      voiceNotice.end,
      voiceNotice.cleaned,
      voiceNotice.raw,
    );
    if (next !== undefined) setDraftText(chatId, next);
    setVoiceNotice(null);
  }, [voiceNotice, chatId]);

  /** A single insert past the file threshold can only come from a paste —
   * stage it as pasted.txt instead of flooding the draft. */
  const handleChangeText = useCallback(
    (text: string) => {
      setSendError(null);
      const acceptAt = acceptAtRef.current;
      if (acceptAt !== null) {
        // Hardware Enter/Tab with an open completion menu: RN inserts the
        // key anyway — remove it and accept the highlighted row instead.
        acceptAtRef.current = null;
        const removed = text[acceptAt];
        if (removed === '\n' || removed === '\t') {
          const without = text.slice(0, acceptAt) + text.slice(acceptAt + 1);
          setDraftText(chatId, without);
        }
        acceptCompletion();
        return;
      }
      const split = splitTextEdit(draftTextRef.current, text);
      if (split.inserted.length > PASTE_FILE_THRESHOLD) {
        const result = stagePastedText(chatId, split.inserted);
        setDraftText(
          chatId,
          result.staged.length > 0 ? split.prefix + split.suffix : text,
        );
        return;
      }
      setDraftText(chatId, text);
    },
    [chatId, acceptCompletion],
  );

  const submit = useCallback(() => {
    if (dictating || processing || localVoiceBusy) return;
    setVoiceNotice(null);
    const text = withPlanPrefixIf(planMode, draft.text.trim());
    // Zeron's own commands consume their trigger before any send path.
    const workspaceRows =
      slashCacheRef.current.get(slashMetaRef.current.context) ?? [];
    const workspaceAction = workspaceCommandForText(draft.text, workspaceRows);
    if (workspaceAction !== undefined && onWorkspaceCommand !== undefined) {
      resetSlash();
      resetMention();
      setDraftText(chatId, '');
      onWorkspaceCommand(workspaceAction);
      return;
    }
    // Canonical references need a host that decodes them; the draft stays.
    if (referencesRequireUpdate(text, refsSupported)) {
      setSendError(t('composer.autocomplete.referencesBlocked'));
      return;
    }
    if (hasAttachments) {
      // Routes per sendPlan; 'blocked' surfaces onSendBlocked — the draft
      // and attachments stay put (nothing silently dropped).
      onSendAttachments(text)
        .then(plan => {
          if (plan === 'blocked') {
            onSendBlocked();
          } else if (plan !== 'direct') {
            clearDraft(chatId);
          }
        })
        // Failures already surface (queueActionError on the enqueue;
        // a 'failed' state on the strip for legacy uploads).
        .catch(() => {});
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
    dictating,
    processing,
    localVoiceBusy,
    onWorkspaceCommand,
    refsSupported,
    resetSlash,
    resetMention,
  ]);

  // Reduce Motion: thumbs/strip animate instantly (no swell/shrink).
  const stripH = hasAttachments ? ATTACHMENT_TILE + 8 : 0;
  const stripO = hasAttachments ? 1 : 0;
  const stripDur = reduceMotion ? 0 : THUMBS_ANIM_MS;

  const right = action.right;
  const showLivePill = live !== 'hidden' && hasText;
  const sendArmed =
    right === 'send' &&
    (action.primary === 'send' || live === 'queue' || live === 'steer');
  const coverSend = dictating || processing || localVoiceBusy;
  // Constant pad: KeyboardStickyView interpolates insets.bottom so this
  // layout height does not snap on isVisible and overshoot the home indicator.
  const homeInset = insets.bottom + 8;

  // Beam geometry = the glass's own bounds; Reduce Motion collapses the
  // sweep to a static ring.
  const [glassSize, setGlassSize] = useState({ w: 0, h: 0 });

  // Autocomplete rows — slash takes precedence when both tokens are live.
  const popupRows: CompletionRowData[] =
    slashUI !== null
      ? slashUI.filtered.map((rowIx, ix) => {
          const c = slashUI.rows[rowIx];
          const isSkill = c.invocation.kind === 'skill';
          const detail =
            c.inputHint !== undefined && c.inputHint !== ''
              ? c.description === ''
                ? `<${c.inputHint}>`
                : `${c.description} · <${c.inputHint}>`
              : c.description;
          return {
            key: `${ix}`,
            icon: isSkill ? 'sparkles' : 'command',
            label: isSkill ? skillDisplayName(c.name) : `/${c.name}`,
            detail,
          };
        })
      : (mentionUI?.results ?? []).map((r, ix) => {
          const slashIx = r.path.lastIndexOf('/');
          return {
            key: `${ix}`,
            icon: r.isDir ? 'folder' : 'doc',
            label: r.path.slice(slashIx + 1),
            detail: slashIx >= 0 ? r.path.slice(0, slashIx) : '',
          };
        });
  const popupActive = slashUI?.active ?? mentionUI?.active;
  const popupLoading = slashUI?.loading ?? mentionUI?.loading ?? false;
  const popupError = slashUI?.error ?? mentionUI?.error;
  const separateSkills = skillPrefsForHarness(harnessId).separateFromSlash;
  const popupEmpty =
    slashUI !== null
      ? slashUI.skill
        ? slashUI.rows.length === 0
          ? slashMetaRef.current.supported
            ? t('composer.autocomplete.noSkills')
            : t('composer.autocomplete.skillsNotAdvertised')
          : t('composer.autocomplete.noMatchingSkills')
        : slashUI.rows.length === 0
        ? separateSkills
          ? t('composer.autocomplete.noCommands')
          : t('composer.autocomplete.noCommandsOrSkills')
        : separateSkills
        ? t('composer.autocomplete.noMatchingCommands')
        : t('composer.autocomplete.noMatchingCommandsOrSkills')
      : mentionUI !== null && mentionUI.token.query === ''
      ? t('composer.autocomplete.noFiles')
      : t('composer.autocomplete.noMatchingFiles');

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
          {question === undefined ? (
            <View
              style={styles.grabberHit}
              accessibilityRole="adjustable"
              accessibilityLabel={t('composer.resize')}
              {...grabberPan.panHandlers}
            >
              <View
                style={[
                  styles.grabber,
                  { backgroundColor: theme.textSecondary },
                ]}
              />
            </View>
          ) : null}
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
              requestId={question.id}
              questions={question.questions}
              onSubmit={(_id, answers) =>
                question.kind === 'input'
                  ? onRespondInput(question.requestId, answers)
                  : onAnswerQuestion(question, answers)
              }
              onDismiss={() => markQuestionAnswered(chatId, question.id)}
            />
          ) : null}

          {/* minHeight spacer: layout grows by extraHeight 1:1, independent
            of iOS multiline TextInput intrinsic size. Text can still fill
            the extra via maxHeight. */}
          <View style={{ minHeight: INPUT_MIN_HEIGHT + effectiveExtra }}>
            <TextInput
              ref={inputRef}
              value={draft.text}
              autoFocus={autoFocus}
              onChangeText={handleChangeText}
              onSelectionChange={e => {
                const { start, end } = e.nativeEvent.selection;
                selRef.current = start;
                selEndRef.current = end;
                // A non-empty selection has no caret → no completion.
                if (start !== end) {
                  resetSlash();
                  resetMention();
                } else {
                  syncCompletion(draftTextRef.current, start);
                }
              }}
              onKeyPress={e => {
                const key = e.nativeEvent.key;
                if (key === 'Escape' || key === 'escape') {
                  dismissCompletion();
                  return;
                }
                const open = slashUI !== null || mentionUI !== null;
                const hasSelection =
                  (slashUI?.active ?? mentionUI?.active) !== undefined;
                if (!open) return;
                if (key === 'ArrowDown' || key === 'UIKeyInputDownArrow') {
                  navigateCompletion(1);
                } else if (key === 'ArrowUp' || key === 'UIKeyInputUpArrow') {
                  navigateCompletion(-1);
                } else if (
                  hasSelection &&
                  (key === 'Enter' || key === 'Return' || key === 'Tab')
                ) {
                  acceptAtRef.current = selRef.current;
                }
              }}
              onFocus={() => {
                focusedRef.current = true;
                onFocusChange?.(true);
              }}
              onBlur={() => {
                focusedRef.current = false;
                resetSlash();
                resetMention();
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
                      groupByProvider={mode === 'compose'}
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
                    {contextSupported && contextOption !== undefined ? (
                      <ContextWindowButton
                        option={contextOption}
                        value={contextChoice}
                        onSelect={onSelectContext ?? (() => {})}
                      />
                    ) : null}
                    <View style={styles.chipSpacer} />
                    <ContextUsageChip usage={contextUsage} />
                  </ScrollView>
                </ChipRowMask>
                <View style={styles.trailingCluster} collapsable={false}>
                  {voiceInputMode !== 'disabled' ? (
                    <VoicePill
                      active={
                        voiceInputMode === 'voiceModel'
                          ? voiceStage === 'recording'
                          : dictating
                      }
                      supported={
                        voiceInputMode === 'voiceModel'
                          ? true
                          : dictationSupported
                      }
                      processing={
                        voiceInputMode === 'voiceModel'
                          ? localVoiceProcessing
                          : processing
                      }
                      processingStage={
                        voiceStage === 'transcribing'
                          ? 'transcribing'
                          : voiceStage === 'cleaning'
                          ? 'cleaning'
                          : undefined
                      }
                      processingCancelable={voiceInputMode === 'voiceModel'}
                      levelTick={voiceTick}
                      onToggle={toggleDictation}
                      onCancel={cancelDictation}
                    />
                  ) : null}
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
        {slashUI !== null || mentionUI !== null ? (
          <ComposerAutocomplete
            testID="composer-autocomplete"
            rows={popupRows}
            activeIndex={popupActive}
            loading={popupLoading}
            error={popupError}
            emptyLabel={popupEmpty}
            onPick={ix => {
              if (slashUI !== null) acceptSlash(ix);
              else acceptMention(ix);
            }}
          />
        ) : null}
        <BorderBeam
          width={glassSize.w}
          height={glassSize.h}
          radius={24}
          runPhase={phase}
          roomState={roomState}
          reduceMotion={reduceMotion}
        />
      </View>

      {sendError !== null ? (
        <Text style={[styles.hint, { color: theme.danger }]}>{sendError}</Text>
      ) : null}
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
      {voiceNotice?.kind === 'cleanupFailed' ||
      voiceNotice?.kind === 'transcribeFailed' ||
      voiceNotice?.kind === 'restore' ? (
        <Animated.View style={noticeAnimStyle}>
          <Glass
            style={[
              styles.voiceBanner,
              { backgroundColor: theme.glassFallbackBackground },
            ]}
          >
            {voiceNotice.kind === 'restore' ? (
              <Pressable
                onPress={restoreVoiceText}
                accessibilityRole="button"
                accessibilityLabel={t('composer.voiceRestore')}
                testID="composer-restore-voice"
                hitSlop={6}
                style={styles.voiceBannerPress}
              >
                <Text style={[styles.voiceBannerAction, { color: theme.text }]}>
                  {t('composer.voiceRestore')}
                </Text>
              </Pressable>
            ) : (
              <Text
                style={[styles.voiceBannerText, { color: theme.text }]}
                accessibilityLiveRegion="polite"
              >
                {voiceNotice.kind === 'cleanupFailed'
                  ? t('composer.voiceCleanupFailed')
                  : t('composer.voiceTranscribeFailed')}
              </Text>
            )}
          </Glass>
        </Animated.View>
      ) : null}

      <View
        testID="composer-home-pad"
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
  voiceBanner: {
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    overflow: 'hidden',
  },
  voiceBannerText: { fontSize: 14, flex: 1 },
  voiceBannerAction: { fontSize: 14, fontWeight: '600' },
  voiceBannerPress: { flex: 1, minHeight: 44, justifyContent: 'center' },
  homePad: {},
});
