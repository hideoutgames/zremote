// SessionScreen — the fork's ChatScreen shape driven by the synchronized
// session store: FlashList + KeyboardChatScrollView transcript, glass composer, scroll
// chevron, reasoning sheet, failed-send banner.

import React, {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  AccessibilityInfo,
  Alert,
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  KeyboardController,
  KeyboardStickyView,
  useKeyboardState,
} from 'react-native-keyboard-controller';
import * as DropdownMenu from '../components/menus/dropdown-menu';
import * as Clipboard from 'expo-clipboard';
import { useStore } from 'zustand';
import {
  useSessionState,
  useRunPhase,
  dismissFailedSend,
} from '../zeron/state/sessionStores';
import { workspaceStore, useChat } from '../zeron/state/workspaceStore';
import {
  useDraft,
  setDraftPendingWorktree,
  restoreFailedSend,
} from '../zeron/state/draftStore';
import {
  modelSettingsFor,
  rememberModelPick,
  rememberModelSettings,
  setPlanMode,
  toggleChatPinned,
  useChatPinned,
  useNewThreadComposerBackground,
  usePinnedModels,
  useRecentModels,
} from '../zeron/state/uiPrefs';
import { sessionTitle } from '../zeron/state/sessionTruth';
import {
  bindPendingWorkedDuration,
  workedDurationStore,
  type FrozenWorkedDuration,
} from '../zeron/state/workedDuration';
import { formatWorkedDurationRange } from '../zeron/state/workingElapsed';
import {
  setChatArchived,
  setChatConfig,
  renameChat,
} from '../zeron/runtime/workspaceActions';
import type { SessionController } from '../zeron/runtime/sessionController';
import { edgeFetchBytes, EdgeHttpError } from '../zeron/transport/edgeHttp';
import { blobUrl } from '../zeron/transport/edge';
import {
  catalogStore,
  modelsFor,
  selectableHarnesses,
} from '../zeron/state/catalogStore';
import { loadCatalog, loadModels } from '../zeron/runtime/catalog';
import { composerMenuModels } from '../zeron/state/pinnedModels';
import { capitalizeLevel } from '../components/effortSliderMath';
import {
  applyEffortLevel,
  applyFastChoice,
  resolveModelTraits,
  selectionForModel,
} from '../components/modelTraits';
import { useCheckoutWatches } from '../hooks/useCheckoutWatches';
import { changeRequestStore } from '../zeron/state/changeRequestStore';
import { useRuntime, useAuthSession } from '../app/runtimeContext';
import {
  FULL_ACCESS_SANDBOX,
  type MessageEntry,
} from '../zeron/protocol/types';
import { Icon } from '../components/Icon';
import { Glass, GlassControl } from '../components/Glass';
import { Composer } from '../components/Composer';
import { ComposeComposer } from '../components/ComposeComposer';
import { ComposerChromeRow } from '../components/ComposerChromeRow';
import { composerPrBadge } from '../components/threadPrs';
import {
  SessionTranscriptList,
  type SessionTranscriptListHandle,
} from '../components/SessionTranscriptList';
import {
  EffortOverlay,
  measureWindowRect,
  type EffortOrigin,
} from '../components/EffortOverlay';
import { REGULAR_MIN_WIDTH } from '../navigation/layout';
import { GlassSheet } from '../components/GlassSheet';
import { QueuePanel } from '../components/QueuePanel';
import { ModelPickerSheet } from '../components/ModelPickerSheet';
import { PrSheet } from '../components/PrSheet';
import type { PrBadgeModel } from '../components/prBadge';
import { SessionSheet } from '../components/SessionSheet';
import {
  dictationUnavailable,
  resolveDictationPort,
} from '../zeron/native/dictation';
import type { DictationPort } from '../zeron/native/dictation';
import { CAP_QUEUE_ACTIONS } from '../zeron/attachments/sendPlan';
import type { SendPlan } from '../zeron/attachments/sendPlan';
import { UserMessage } from '../components/transcript/UserMessage';
import { AssistantMessage } from '../components/transcript/AssistantMessage';
import { PlanSheet } from '../components/PlanSheet';
import { applyBuildPrefix, IMPLEMENT_PLAN_TEXT } from '../components/planMode';
import { ThreadDetailsSheet } from '../components/ThreadDetailsSheet';
import { ThreadUsageSheet } from '../components/ThreadUsageSheet';
import { SubagentsSheet } from '../components/SubagentsSheet';
import { FileDiffSheet } from '../components/FileDiffSheet';
import type { FileDiffRequest } from '../components/FileDiffSheet';
import {
  ScrollToBottomButton,
  SCROLL_TO_BOTTOM_SIZE,
} from '../components/ScrollToBottomButton';
import { useTheme } from '../theme';
import { useChromeTheme } from '../chromeTheme';
import { t } from '../i18n/strings';
import { useKeyboardDismissPan } from '../navigation/keyboardDismissGesture';
import { FilesScreen } from './FilesScreen';
import { TerminalScreen } from './TerminalScreen';
import { HistoryScreen } from './HistoryScreen';
import { createLog } from '../zeron/log';
import { ComposerStickyBottom } from '../components/ComposerChromeAnim';
import { ComposeKeyboardShift } from '../components/ComposeKeyboardShift';
import { composerKeyboardStickyOffset } from '../navigation/composeKeyboardShift';
import { wallpaperScreenFill } from '../zeron/state/newThreadBackground';
import { ChatBackgroundBlur } from '../components/SessionBackgroundBlur';

const log = createLog();

const workedForCaption = (
  item: MessageEntry,
  hide: boolean,
  byId: Record<string, FrozenWorkedDuration>,
): string | undefined => {
  if (hide) return undefined;
  if (item.status !== 'complete' && item.status !== 'aborted') return undefined;
  const frozen = byId[item.id];
  return frozen === undefined
    ? undefined
    : formatWorkedDurationRange(frozen.startedAt, frozen.endedAt);
};

const ReasoningSheet = React.lazy(() =>
  import('../components/ReasoningSheet').then(m => ({
    default: m.ReasoningSheet,
  })),
);

// Do not add Reanimated worklets in this screen. React Compiler + worklets
// 0.10.x serializes a wide memo cache (props, runtime, Sets) and 0.10.1
// throws, which RCTFatal aborts in Release/TestFlight. Extract a tiny child
// if a worklet is required. ActiveSessionScreen is `'use no memo'` for the
// same reason; the transcript list is a separate compiled-off child.

export function SessionScreen({
  chatId,
  onBack,
  onCreated,
  leadingIcon,
  contentMaxWidth,
  composerMaxWidth,
  openGeneration = 0,
}: {
  chatId?: string;
  onBack: () => void;
  onCreated?: (chatId: string) => void;
  /** iPad split view: replaces the back chevron with a sidebar toggle. */
  leadingIcon?: string;
  /** iPad: cap the transcript measure (~720pt or detail − 48pt), centered. */
  contentMaxWidth?: number;
  /** iPad: cap the composer stack inside the detail column. */
  composerMaxWidth?: number;
  /** Bumps on every Home/deep-link open so reopen also lands at the tail. */
  openGeneration?: number;
}) {
  if (chatId === undefined) {
    return (
      <ComposeSessionScreen
        onBack={onBack}
        onCreated={onCreated}
        leadingIcon={leadingIcon}
        composerMaxWidth={composerMaxWidth}
      />
    );
  }
  return (
    <ActiveSessionScreen
      chatId={chatId}
      onBack={onBack}
      leadingIcon={leadingIcon}
      contentMaxWidth={contentMaxWidth}
      composerMaxWidth={composerMaxWidth}
      openGeneration={openGeneration}
    />
  );
}

function ComposeSessionScreen({
  onBack,
  onCreated,
  leadingIcon,
  composerMaxWidth,
}: {
  onBack: () => void;
  onCreated?: (chatId: string) => void;
  leadingIcon?: string;
  composerMaxWidth?: number;
}) {
  const theme = useTheme();
  const chrome = useChromeTheme();
  const insets = useSafeAreaInsets();
  const [composerH, setComposerH] = useState(0);
  const dismissPan = useKeyboardDismissPan();
  const wallpaper = useNewThreadComposerBackground() !== undefined;
  return (
    <View
      style={[
        styles.container,
        { backgroundColor: wallpaperScreenFill(theme.background, wallpaper) },
      ]}
    >
      {/* Pan lives here, not on compose-center, so checkout chips can scroll. */}
      <View
        testID="compose-dismiss"
        style={styles.composeDismiss}
        {...dismissPan.panHandlers}
      />
      <ComposeKeyboardShift
        testID="compose-center"
        composerHeight={composerH}
        style={styles.composeCenter}
        pointerEvents="box-none"
      >
        <ComposeComposer
          autoFocus
          composerMaxWidth={composerMaxWidth}
          onCreated={id => onCreated?.(id)}
          onLayout={e => setComposerH(e.nativeEvent.layout.height)}
        />
      </ComposeKeyboardShift>
      <View
        style={[styles.header, { paddingTop: insets.top + 6 }]}
        pointerEvents="box-none"
      >
        <View style={styles.headerRow} pointerEvents="box-none">
          <GlassControl
            interactive
            onPress={() => {
              KeyboardController.dismiss();
              onBack();
            }}
            accessibilityRole="button"
            accessibilityLabel={
              leadingIcon !== undefined
                ? t('sidebar.toggle')
                : t('session.back')
            }
            style={styles.circle}
          >
            <Icon
              name={(leadingIcon ?? 'chevron.left') as never}
              size={18}
              color={chrome.text}
            />
          </GlassControl>
        </View>
      </View>
    </View>
  );
}

function ActiveSessionScreen({
  chatId,
  onBack,
  leadingIcon,
  contentMaxWidth,
  composerMaxWidth,
  openGeneration,
}: {
  chatId: string;
  onBack: () => void;
  leadingIcon?: string;
  contentMaxWidth?: number;
  composerMaxWidth?: number;
  openGeneration: number;
}) {
  'use no memo';
  const theme = useTheme();
  const chrome = useChromeTheme();
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const runtime = useRuntime();
  const auth = useAuthSession();

  // Open off the render path: `loro()` / Nitro LoroDoc throws must not
  // become a first-paint ErrorBoundary. retain on mount, release on unmount.
  const [controller, setController] = useState<SessionController | undefined>(
    undefined,
  );
  useEffect(() => {
    if (runtime === null) {
      setController(undefined);
      return;
    }
    try {
      const c = runtime.openSession(chatId).retain();
      setController(c);
      return () => {
        c.release();
        setController(undefined);
      };
    } catch (e) {
      const name = e instanceof Error ? e.name : 'Error';
      log.warn(`openSession failed (${name})`);
      setController(undefined);
      return;
    }
  }, [runtime, chatId]);

  const session = useSessionState(chatId);
  const chat = useChat(chatId);
  const row = useStore(workspaceStore, s => s.sessions[chatId]);
  const deviceId = runtime?.deviceId ?? '';
  const phase = useRunPhase(chatId, row, chat, deviceId);
  const draft = useDraft(chatId);

  const hostDeviceId = chat?.deviceId;
  const catalog = useStore(catalogStore, s =>
    hostDeviceId === undefined ? undefined : s.byDevice[hostDeviceId],
  );
  useEffect(() => {
    if (runtime !== null && hostDeviceId !== undefined && catalog === undefined)
      loadCatalog(runtime, hostDeviceId, { allowMockHarness: true }).catch(
        () => {},
      );
  }, [runtime, hostDeviceId, catalog]);
  const harness = catalog?.harnesses.find(h => h.id === chat?.config?.harness);

  const [showScrollDown, setShowScrollDown] = useState(false);
  const [reasoning, setReasoning] = useState<string | null>(null);
  const composerRef = useRef<View>(null);
  const transcriptRef = useRef<SessionTranscriptListHandle>(null);

  const entries = session.entries;
  const openKey = `${chatId}:${openGeneration}`;
  const agentWorking =
    phase === 'working' ||
    phase === 'queuedLocally' ||
    phase === 'synchronized';
  const lastEntryId = entries[entries.length - 1]?.id;
  const workedByMessage = useStore(workedDurationStore, s => s.byMessageId);

  useEffect(() => {
    bindPendingWorkedDuration(chatId);
  }, [chatId, entries]);

  // Local send/steer ids play SlideInDown once. Historical rows (thread
  // open, list recycle) must not — UserMessage entering is mount-time.
  const enterIdsRef = useRef(new Set<string>());
  for (const p of session.pendingSends) {
    enterIdsRef.current.add(p.messageId);
  }
  const onUserMessageEntered = useCallback((id: string) => {
    enterIdsRef.current.delete(id);
  }, []);

  const openReasoning = useCallback((text: string) => setReasoning(text), []);

  const onFetchBlob = useCallback(
    async (partId: string): Promise<string> => {
      if (runtime === null) throw new Error('no runtime');
      try {
        const { bytes } = await edgeFetchBytes(
          blobUrl(runtime.cfg, chatId, partId),
          auth,
          {},
          runtime.fetchImpl,
        );
        return new TextDecoder().decode(bytes);
      } catch (e) {
        const status = e instanceof EdgeHttpError ? e.status : 'error';
        log.warn(`blob fetch failed (${status})`);
        throw e;
      }
    },
    [runtime, auth, chatId],
  );

  const renderEntry = useCallback(
    ({ item }: { item: MessageEntry }) =>
      item.role === 'user' ? (
        <UserMessage
          entry={item}
          chatId={chatId}
          animateEnter={enterIdsRef.current.has(item.id)}
          onEntered={onUserMessageEntered}
        />
      ) : (
        <AssistantMessage
          entry={item}
          onOpenReasoning={openReasoning}
          onFetchBlob={onFetchBlob}
          onOpenPlan={(name, markdown) => setPlanSheet({ name, markdown })}
          onOpenFileDiff={file => setFileDiff(file)}
          commands={session.commands}
          showWorking={agentWorking && item.id === lastEntryId}
          workingChatId={chatId}
          workingStartedAt={row?.startedAt ?? row?.updatedAt ?? Date.now()}
          workedFor={workedForCaption(
            item,
            agentWorking && item.id === lastEntryId,
            workedByMessage,
          )}
        />
      ),
    [
      openReasoning,
      onFetchBlob,
      chatId,
      onUserMessageEntered,
      session.commands,
      agentWorking,
      lastEntryId,
      row?.startedAt,
      row?.updatedAt,
      workedByMessage,
    ],
  );

  const doSend = useCallback(
    (text: string): boolean => {
      if (controller === undefined) return false;
      const wt = draft.pendingWorktree;
      try {
        controller.sendRun(
          text,
          { config: chat?.config, cwd: chat?.cwd },
          {
            ...(wt !== undefined ? { worktree: wt } : {}),
          },
        );
      } catch {
        return false;
      }
      if (wt !== undefined) setDraftPendingWorktree(chatId, undefined);
      transcriptRef.current?.noteSent(entries.length);
      transcriptRef.current?.scrollMessageToEnd({
        animated: entries.length > 0,
        closeKeyboard: true,
      });
      return true;
    },
    [controller, draft.pendingWorktree, chat, chatId, entries.length],
  );

  const doSteer = useCallback(
    (text: string) => controller?.sendSteer(text),
    [controller],
  );
  const doStop = useCallback(() => controller?.interrupt(), [controller]);
  const doQueue = useCallback(
    (text: string) => controller?.queueMessage(text),
    [controller],
  );
  const doCancel = useCallback(() => {
    // Cancel the own still-pending run/steer command (queuedLocally /
    // synchronized phases) — same rule the phase machine used to pick it.
    const own = session.commands.find(
      c =>
        c.issuedBy === deviceId &&
        (c.kind === 'run' || c.kind === 'steer') &&
        !['applied', 'rejected', 'expired', 'superseded', 'cancelled'].includes(
          c.status,
        ),
    );
    if (own !== undefined) controller?.cancelOwnCommand(own.id);
  }, [controller, session, deviceId]);
  const doRespond = useCallback(
    (requestId: string, answers: { questionId: string; labels: string[] }[]) =>
      controller?.respondInput(requestId, answers),
    [controller],
  );

  const doSendAttachments = useCallback(
    (text: string): Promise<SendPlan> => {
      if (controller === undefined) return Promise.resolve('blocked');
      return controller.sendWithAttachments(
        text,
        { config: chat?.config, cwd: chat?.cwd },
        draft.attachments,
        {
          worktree: draft.pendingWorktree,
          phase,
        },
      );
    },
    [
      controller,
      chat?.config,
      chat?.cwd,
      draft.attachments,
      draft.pendingWorktree,
      phase,
    ],
  );

  const onSendBlocked = useCallback(() => {
    Alert.alert(t('session.attachmentsBlocked'));
  }, []);

  const onRename = useCallback(() => {
    Alert.prompt(
      t('session.rename'),
      undefined,
      text => {
        if (text.trim() !== '' && runtime !== null)
          renameChat(runtime, chatId, text.trim());
      },
      'plain-text',
      chat?.title ?? '',
    );
  }, [runtime, chatId, chat?.title]);

  const onArchive = useCallback(() => {
    if (runtime !== null && chat !== undefined)
      setChatArchived(runtime, chatId, !chat.archived);
  }, [runtime, chat, chatId]);

  const pinned = useChatPinned(chatId);
  const onPin = useCallback(() => toggleChatPinned(chatId), [chatId]);

  const onCopyId = useCallback(() => {
    Clipboard.setStringAsync(chatId).catch(() => {});
  }, [chatId]);

  const host = useStore(workspaceStore, s =>
    chat === undefined
      ? undefined
      : s.devices.find(d => d.id === chat.deviceId),
  );
  const capabilities = useMemo(
    () => new Set(host?.capabilities ?? []),
    [host?.capabilities],
  );
  const space = useStore(workspaceStore, s =>
    chat?.spaceId === undefined
      ? undefined
      : s.spaces.find(sp => sp.id === chat.spaceId),
  );
  const [pickerOpen, setPickerOpen] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const [queueDragging, setQueueDragging] = useState(false);
  const [effortOpen, setEffortOpen] = useState(false);
  const [effortOrigin, setEffortOrigin] = useState<EffortOrigin | undefined>(
    undefined,
  );
  const [effortAnchor, setEffortAnchor] = useState<EffortOrigin | undefined>(
    undefined,
  );
  const [prSheet, setPrSheet] = useState<PrBadgeModel | null>(null);
  const pendingPrRef = useRef<PrBadgeModel | null>(null);
  const [composerFocused, setComposerFocused] = useState(false);
  const keyboardHeight = useKeyboardState(s => s.height);
  const keyboardWasVisible = useRef(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [usageOpen, setUsageOpen] = useState(false);
  const [subagentsOpen, setSubagentsOpen] = useState(false);
  const [planSheet, setPlanSheet] = useState<{
    name: string;
    markdown: string;
  } | null>(null);
  const [fileDiff, setFileDiff] = useState<FileDiffRequest | null>(null);
  const [toolSheet, setToolSheet] = useState<
    'files' | 'terminal' | 'history' | null
  >(null);

  // Announce run-phase transitions for VoiceOver (working → awaiting
  // input / completed / failed).
  const prevPhaseRef = useRef(phase);
  useEffect(() => {
    const prev = prevPhaseRef.current;
    prevPhaseRef.current = phase;
    if (phase === prev) return;
    const key =
      phase === 'awaitingInput'
        ? 'session.announce.awaitingInput'
        : phase === 'errored'
        ? 'session.announce.errored'
        : (prev === 'working' || prev === 'awaitingInput') && phase === 'idle'
        ? 'session.announce.completed'
        : undefined;
    if (key !== undefined) AccessibilityInfo.announceForAccessibility(t(key));
  }, [phase]);

  useEffect(() => {
    if (keyboardHeight > 0) {
      keyboardWasVisible.current = true;
      return;
    }
    if (!keyboardWasVisible.current) return;
    keyboardWasVisible.current = false;
    setComposerFocused(false);
  }, [keyboardHeight]);

  useEffect(() => {
    if (toolSheet !== null) return;
    const badge = pendingPrRef.current;
    if (badge == null) return;
    pendingPrRef.current = null;
    setPrSheet(badge);
  }, [toolSheet]);
  const [dictation, setDictation] =
    useState<DictationPort>(dictationUnavailable);
  useEffect(() => {
    let mounted = true;
    resolveDictationPort().then(port => {
      if (mounted) setDictation(port);
    });
    return () => {
      mounted = false;
    };
  }, []);
  const recents = useRecentModels();
  const pinnedModels = usePinnedModels();
  const catalogTick = catalog?.loadedAt ?? 0;
  const catalogModels = useMemo(() => {
    if (hostDeviceId === undefined) return [];
    const out: {
      harness: string;
      model: string;
      label: string;
      harnessName: string;
    }[] = [];
    for (const h of selectableHarnesses(hostDeviceId)) {
      for (const m of modelsFor(hostDeviceId, h.id)) {
        out.push({
          harness: h.id,
          model: m.id,
          label: m.label,
          harnessName: h.name,
        });
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hostDeviceId, catalogTick]);
  const currentHarness = chat?.config?.harness;
  const currentModelId = chat?.config?.model;
  const recentItems = useMemo(
    () =>
      composerMenuModels(
        pinnedModels,
        recents,
        catalogModels,
        currentHarness !== undefined && currentModelId !== undefined
          ? { harness: currentHarness, model: currentModelId }
          : undefined,
      ),
    [pinnedModels, recents, catalogModels, currentHarness, currentModelId],
  );
  const currentModel =
    hostDeviceId === undefined || chat?.config?.harness === undefined
      ? undefined
      : modelsFor(hostDeviceId, chat.config.harness).find(
          m => m.id === chat.config?.model,
        );
  const harnessModels =
    hostDeviceId === undefined || chat?.config?.harness === undefined
      ? []
      : modelsFor(hostDeviceId, chat.config.harness);
  const harnessLevels =
    hostDeviceId === undefined || chat?.config?.harness === undefined
      ? undefined
      : selectableHarnesses(hostDeviceId).find(
          h => h.id === chat.config?.harness,
        )?.reasoningLevels;
  const traits = resolveModelTraits(
    currentModel,
    harnessModels,
    harnessLevels,
    {
      model: chat?.config?.model,
      reasoning: chat?.config?.reasoning,
      modelOptions: chat?.config?.modelOptions,
    },
  );
  const effortLevels = traits.effort?.levels ?? [];
  const fastOption = traits.fast?.option;
  const fastEnabled = traits.fast?.enabled ?? false;
  const modelLabel =
    currentModel?.label ?? chat?.config?.model ?? t('picker.default');
  const effortLabel = capitalizeLevel(
    traits.effort?.value ?? t('picker.effort'),
  );

  useEffect(() => {
    if (
      runtime !== null &&
      hostDeviceId !== undefined &&
      chat?.config?.harness !== undefined &&
      modelsFor(hostDeviceId, chat.config.harness).length === 0
    )
      loadModels(runtime, hostDeviceId, chat.config.harness).catch(() => {});
  }, [runtime, hostDeviceId, chat?.config?.harness]);

  useCheckoutWatches(
    runtime,
    chatId,
    hostDeviceId,
    chat?.cwd ?? space?.path,
    chat?.branch,
    chat?.checkoutId,
  );
  const checkoutSummary = useStore(
    changeRequestStore,
    s => s.byChat[chatId]?.changeRequest ?? undefined,
  );
  const checkoutDiff = useStore(changeRequestStore, s => s.diffByChat[chatId]);
  const prBadge = useMemo(
    () => composerPrBadge(checkoutSummary, checkoutDiff),
    [checkoutSummary, checkoutDiff],
  );
  const keyboardOffset = useMemo(
    () => composerKeyboardStickyOffset(insets.bottom),
    [insets.bottom],
  );

  const wallpaper = useNewThreadComposerBackground() !== undefined;

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: wallpaperScreenFill(theme.background, wallpaper) },
      ]}
    >
      <ChatBackgroundBlur />
      <SessionTranscriptList
        key={openKey}
        ref={transcriptRef}
        openKey={openKey}
        entries={entries}
        renderEntry={renderEntry}
        composerRef={composerRef}
        contentMaxWidth={contentMaxWidth}
        windowWidth={windowWidth}
        windowHeight={windowHeight}
        insetsTop={insets.top}
        insetsBottom={insets.bottom}
        onComposerHeight={() => {}}
        onShowScrollDown={setShowScrollDown}
        working={agentWorking}
        chatId={chatId}
        startedAt={row?.startedAt ?? row?.updatedAt ?? Date.now()}
      />

      {/* Header: back, title (tap → session menu), overflow.
          box-none: taps in the transparent gaps reach the transcript. */}
      <View
        style={[styles.header, { paddingTop: insets.top + 6 }]}
        pointerEvents="box-none"
      >
        <View style={styles.headerRow} pointerEvents="box-none">
          <View style={styles.headerCenter} pointerEvents="box-none">
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <Pressable
                  style={styles.titleHit}
                  testID="session-title-pill"
                  accessibilityRole="button"
                  accessibilityLabel={t('session.titleMenu')}
                >
                  <Text
                    style={[styles.title, { color: chrome.text }]}
                    numberOfLines={1}
                    ellipsizeMode="tail"
                    testID="session-header-title"
                  >
                    {sessionTitle(chat)}
                  </Text>
                </Pressable>
              </DropdownMenu.Trigger>
              <DropdownMenu.Content>
                <DropdownMenu.Item key="rename" onSelect={onRename}>
                  <DropdownMenu.ItemTitle>
                    {t('session.rename')}
                  </DropdownMenu.ItemTitle>
                </DropdownMenu.Item>
                <DropdownMenu.Group>
                  <DropdownMenu.Item key="pin" onSelect={onPin}>
                    <DropdownMenu.ItemTitle>
                      {pinned ? t('session.unpin') : t('session.pin')}
                    </DropdownMenu.ItemTitle>
                    <DropdownMenu.ItemIcon
                      ios={{ name: pinned ? 'pin.slash' : 'pin' }}
                    />
                  </DropdownMenu.Item>
                </DropdownMenu.Group>
                <DropdownMenu.Item key="archive" onSelect={onArchive}>
                  <DropdownMenu.ItemTitle>
                    {chat?.archived
                      ? t('home.row.unarchive')
                      : t('session.archive')}
                  </DropdownMenu.ItemTitle>
                </DropdownMenu.Item>
                <DropdownMenu.Item key="copy" onSelect={onCopyId}>
                  <DropdownMenu.ItemTitle>
                    {t('session.copyId')}
                  </DropdownMenu.ItemTitle>
                  <DropdownMenu.ItemIcon ios={{ name: 'doc.on.doc' }} />
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Root>
          </View>
          <GlassControl
            interactive
            onPress={() => {
              setComposerFocused(false);
              KeyboardController.dismiss();
              onBack();
            }}
            accessibilityRole="button"
            accessibilityLabel={
              leadingIcon !== undefined
                ? t('sidebar.toggle')
                : t('session.back')
            }
            style={styles.circle}
          >
            <Icon
              name={(leadingIcon ?? 'chevron.left') as never}
              size={18}
              color={chrome.text}
            />
          </GlassControl>
          <View style={styles.headerRight}>
            <Glass interactive style={styles.circle}>
              <DropdownMenu.Root>
                <DropdownMenu.Trigger asChild>
                  <Pressable
                    style={styles.controlFill}
                    accessibilityRole="button"
                    accessibilityLabel={t('session.overflow')}
                  >
                    <Icon name="ellipsis" size={18} color={chrome.text} />
                  </Pressable>
                </DropdownMenu.Trigger>
                <DropdownMenu.Content>
                  <DropdownMenu.Item
                    key="details"
                    onSelect={() => setDetailsOpen(true)}
                  >
                    <DropdownMenu.ItemTitle>
                      {t('session.details')}
                    </DropdownMenu.ItemTitle>
                    <DropdownMenu.ItemIcon ios={{ name: 'info.circle' }} />
                  </DropdownMenu.Item>
                  <DropdownMenu.Item
                    key="usage"
                    onSelect={() => setUsageOpen(true)}
                  >
                    <DropdownMenu.ItemTitle>
                      {t('session.usage')}
                    </DropdownMenu.ItemTitle>
                    <DropdownMenu.ItemIcon ios={{ name: 'chart.bar' }} />
                  </DropdownMenu.Item>
                  <DropdownMenu.Item
                    key="subagents"
                    onSelect={() => setSubagentsOpen(true)}
                  >
                    <DropdownMenu.ItemTitle>
                      {t('session.subagents')}
                    </DropdownMenu.ItemTitle>
                    <DropdownMenu.ItemIcon ios={{ name: 'person.2' }} />
                  </DropdownMenu.Item>
                  <DropdownMenu.Separator />
                  <DropdownMenu.Item
                    key="history"
                    onSelect={() => setToolSheet('history')}
                  >
                    <DropdownMenu.ItemTitle>
                      {t('session.history')}
                    </DropdownMenu.ItemTitle>
                    <DropdownMenu.ItemIcon
                      ios={{ name: 'arrow.triangle.branch' }}
                    />
                  </DropdownMenu.Item>
                  <DropdownMenu.Item
                    key="files"
                    onSelect={() => setToolSheet('files')}
                  >
                    <DropdownMenu.ItemTitle>
                      {t('session.files')}
                    </DropdownMenu.ItemTitle>
                    <DropdownMenu.ItemIcon ios={{ name: 'folder' }} />
                  </DropdownMenu.Item>
                  <DropdownMenu.Item
                    key="terminal"
                    onSelect={() => {
                      KeyboardController.dismiss();
                      setComposerFocused(false);
                      setToolSheet('terminal');
                    }}
                  >
                    <DropdownMenu.ItemTitle>
                      {t('session.terminal')}
                    </DropdownMenu.ItemTitle>
                    <DropdownMenu.ItemIcon ios={{ name: 'terminal' }} />
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Root>
            </Glass>
          </View>
        </View>
      </View>

      {composerFocused && keyboardHeight > 0 ? (
        <Pressable
          testID="composer-focus-dim"
          style={[
            styles.focusDim,
            theme.scheme === 'dark'
              ? styles.focusDimDark
              : styles.focusDimLight,
          ]}
          accessible
          accessibilityRole="button"
          accessibilityLabel={t('composer.dismissKeyboard')}
          onPress={() => {
            KeyboardController.dismiss();
            setComposerFocused(false);
          }}
        />
      ) : null}

      {session.failedSends.length > 0 ? (
        <ComposerStickyBottom
          extra={10}
          style={styles.failedWrap}
          pointerEvents="box-none"
        >
          <KeyboardStickyView offset={keyboardOffset} pointerEvents="box-none">
            {session.failedSends.map(f => (
              <Glass
                key={f.messageId}
                style={[
                  styles.failedBanner,
                  { backgroundColor: chrome.glassFallbackBackground },
                ]}
              >
                <View
                  style={[styles.failedDot, { backgroundColor: theme.danger }]}
                />
                <Text style={[styles.failedText, { color: chrome.text }]}>
                  {t('session.failedSend')}
                </Text>
                <Pressable
                  onPress={() => {
                    restoreFailedSend(chatId, f.text);
                    dismissFailedSend(chatId, f.messageId);
                  }}
                  hitSlop={6}
                  accessibilityRole="button"
                  accessibilityLabel={t('session.restoreDraft')}
                >
                  <Text style={[styles.failedAction, { color: chrome.text }]}>
                    {t('session.restoreDraft')}
                  </Text>
                </Pressable>
              </Glass>
            ))}
          </KeyboardStickyView>
        </ComposerStickyBottom>
      ) : null}

      <ComposerStickyBottom
        extra={10}
        style={styles.scrollDown}
        pointerEvents="box-none"
      >
        <KeyboardStickyView offset={keyboardOffset} pointerEvents="box-none">
          <View style={styles.scrollDownSlot} pointerEvents="box-none">
            {showScrollDown ? (
              <ScrollToBottomButton
                onPress={() =>
                  transcriptRef.current?.followEnd({
                    animated: true,
                    closeKeyboard: false,
                  })
                }
              />
            ) : null}
          </View>
        </KeyboardStickyView>
      </ComposerStickyBottom>

      <KeyboardStickyView
        testID="session-composer"
        offset={keyboardOffset}
        style={styles.composer}
      >
        <View
          ref={composerRef}
          onLayout={event => transcriptRef.current?.onComposerLayout(event)}
          testID="session-composer-column"
          style={[
            styles.measureCap,
            composerMaxWidth !== undefined
              ? { maxWidth: composerMaxWidth }
              : undefined,
          ]}
        >
          <ComposerChromeRow
            queueCount={session.queue.length}
            onOpenQueue={() => setQueueOpen(true)}
            pr={prBadge}
            onOpenPr={() => {
              if (prBadge !== undefined) setPrSheet(prBadge);
            }}
          />
          <Composer
            chatId={chatId}
            phase={phase}
            roomState={session.room}
            harness={harness}
            capabilities={capabilities}
            modelLabel={modelLabel}
            harnessId={chat?.config?.harness}
            recentItems={recentItems}
            onPickRecentModel={(h, m) => {
              if (runtime === null || chat === undefined) return;
              if (
                chat.config?.harness !== undefined &&
                chat.config.harness !== '' &&
                h !== chat.config.harness
              )
                return;
              const catalogModel = modelsFor(chat.deviceId, h).find(
                catalogRow => catalogRow.id === m,
              );
              const siblings = modelsFor(chat.deviceId, h);
              const stored = modelSettingsFor(h, m);
              const same =
                h === chat.config?.harness && m === chat.config?.model;
              const live = same
                ? {
                    reasoning: chat.config?.reasoning,
                    modelOptions: chat.config?.modelOptions,
                  }
                : undefined;
              const picked = selectionForModel(
                catalogModel,
                siblings,
                selectableHarnesses(chat.deviceId).find(hRow => hRow.id === h)
                  ?.reasoningLevels,
                stored,
                live,
              );
              setChatConfig(runtime, chat.id, {
                harness: h,
                model: m,
                modelOptions: picked.modelOptions,
                reasoning: picked.reasoning,
                sandbox: FULL_ACCESS_SANDBOX,
              });
              rememberModelPick({ harness: h, model: m });
            }}
            onOpenMoreModels={() => setPickerOpen(true)}
            effortLabel={effortLabel}
            effortSupported={effortLevels.length > 0}
            fastSupported={traits.fast !== undefined}
            fastOption={fastOption}
            fastEnabled={fastEnabled}
            fastChoice={traits.fast?.choice}
            effortOpen={effortOpen}
            onOpenEffort={origin => {
              Keyboard.dismiss();
              setEffortOrigin(origin);
              if (windowWidth < REGULAR_MIN_WIDTH) {
                setEffortAnchor(undefined);
                setEffortOpen(true);
                return;
              }
              measureWindowRect(composerRef.current, rect => {
                setEffortAnchor(rect);
                setEffortOpen(true);
              });
            }}
            onSelectFast={choice => {
              if (runtime === null || chat === undefined) return;
              const patch = applyFastChoice(
                traits,
                choice,
                {
                  model: chat.config?.model,
                  reasoning: chat.config?.reasoning,
                  modelOptions: chat.config?.modelOptions,
                },
                harnessModels,
              );
              setChatConfig(runtime, chat.id, {
                harness: chat.config?.harness ?? '',
                model: patch.model,
                reasoning: patch.reasoning,
                sandbox: FULL_ACCESS_SANDBOX,
                modelOptions: patch.modelOptions,
              });
              if (
                chat.config?.harness !== undefined &&
                patch.model !== undefined
              )
                rememberModelSettings(chat.config.harness, patch.model, {
                  reasoning: patch.reasoning,
                  modelOptions: patch.modelOptions,
                });
            }}
            onFocusChange={setComposerFocused}
            dictation={dictation}
            onSend={doSend}
            onSteer={doSteer}
            onQueue={doQueue}
            onStop={doStop}
            onCancel={doCancel}
            onSendAttachments={doSendAttachments}
            onRespondInput={doRespond}
            onSendBlocked={onSendBlocked}
          />
        </View>
      </KeyboardStickyView>

      {effortOpen ? (
        <EffortOverlay
          levels={effortLevels}
          value={traits.effort?.value}
          origin={effortOrigin}
          anchor={effortAnchor}
          onChange={level => {
            if (runtime === null || chat === undefined) return;
            const patch = applyEffortLevel(
              traits,
              level,
              {
                model: chat.config?.model,
                reasoning: chat.config?.reasoning,
                modelOptions: chat.config?.modelOptions,
              },
              harnessModels,
            );
            setChatConfig(runtime, chat.id, {
              harness: chat.config?.harness ?? '',
              model: patch.model,
              modelOptions: patch.modelOptions,
              reasoning: patch.reasoning,
              sandbox: FULL_ACCESS_SANDBOX,
            });
            if (chat.config?.harness !== undefined && patch.model !== undefined)
              rememberModelSettings(chat.config.harness, patch.model, {
                reasoning: patch.reasoning,
                modelOptions: patch.modelOptions,
              });
          }}
          onDismiss={() => {
            setEffortOpen(false);
            setEffortOrigin(undefined);
            setEffortAnchor(undefined);
          }}
        />
      ) : null}

      {queueOpen ? (
        <GlassSheet
          title={t('queue.title')}
          onDismiss={() => setQueueOpen(false)}
          draggable={!queueDragging}
        >
          <QueuePanel
            queue={session.queue}
            actionsSupported={capabilities.has(CAP_QUEUE_ACTIONS)}
            pending={session.queueActionsPending}
            error={session.queueActionError}
            canSteer={
              harness?.supportsSteering === true &&
              harness.steeringMode === 'step-boundary'
            }
            onAction={(id, a) => {
              controller?.queueAction(id, a).catch(() => {});
            }}
            onMove={(id, to) => {
              controller?.moveQueued(id, to);
            }}
            onDragging={setQueueDragging}
          />
        </GlassSheet>
      ) : null}

      {prSheet !== null ? (
        <PrSheet
          chatId={chatId}
          badge={prSheet}
          onDismiss={() => setPrSheet(null)}
        />
      ) : null}

      {pickerOpen && runtime !== null && chat !== undefined ? (
        <ModelPickerSheet
          runtime={runtime}
          chat={chat}
          phase={phase}
          onClose={() => setPickerOpen(false)}
          formSheet={windowWidth >= 700}
          lockHarness
        />
      ) : null}

      {detailsOpen && chat !== undefined ? (
        <ThreadDetailsSheet
          chat={chat}
          host={host}
          modelLabel={modelLabel}
          onDismiss={() => setDetailsOpen(false)}
          onRename={() => {
            setDetailsOpen(false);
            onRename();
          }}
        />
      ) : null}

      {usageOpen && chat !== undefined ? (
        <ThreadUsageSheet
          deviceId={chat.deviceId}
          onDismiss={() => setUsageOpen(false)}
        />
      ) : null}

      {subagentsOpen ? (
        <SubagentsSheet
          entries={entries}
          onDismiss={() => setSubagentsOpen(false)}
        />
      ) : null}

      {planSheet !== null ? (
        <PlanSheet
          name={planSheet.name}
          markdown={planSheet.markdown}
          onDismiss={() => setPlanSheet(null)}
          onImplement={() => {
            setPlanSheet(null);
            setPlanMode(chatId, false);
            doSend(applyBuildPrefix(IMPLEMENT_PLAN_TEXT));
          }}
        />
      ) : null}

      {fileDiff !== null ? (
        <FileDiffSheet
          chatId={chatId}
          request={fileDiff}
          onDismiss={() => setFileDiff(null)}
        />
      ) : null}

      {reasoning !== null ? (
        <Suspense fallback={null}>
          <ReasoningSheet
            reasoning={reasoning}
            onDismiss={() => setReasoning(null)}
          />
        </Suspense>
      ) : null}

      {toolSheet === 'history' ? (
        <SessionSheet
          title={t('session.history')}
          fill
          onDismiss={() => setToolSheet(null)}
        >
          <HistoryScreen
            chatId={chatId}
            onOpenPr={badge => {
              pendingPrRef.current = badge;
              setToolSheet(null);
            }}
          />
        </SessionSheet>
      ) : null}
      {toolSheet === 'files' ? (
        <SessionSheet fill onDismiss={() => setToolSheet(null)}>
          <FilesScreen chatId={chatId} />
        </SessionSheet>
      ) : null}
      {toolSheet === 'terminal' ? (
        <SessionSheet
          fill
          initialDetentIndex={1}
          onDismiss={() => setToolSheet(null)}
        >
          <TerminalScreen chatId={chatId} />
        </SessionSheet>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  composer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 3,
    alignItems: 'center',
  },
  scrollDown: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  scrollDownSlot: {
    width: SCROLL_TO_BOTTOM_SIZE,
    height: SCROLL_TO_BOTTOM_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  composeDismiss: {
    ...StyleSheet.absoluteFill,
    zIndex: 1,
  },
  composeCenter: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 2,
  },
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    paddingBottom: 8,
    zIndex: 3,
  },
  headerRow: {
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerCenter: {
    position: 'absolute',
    left: 56,
    right: 56,
    top: 0,
    bottom: 0,
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  measureCap: { width: '100%' },
  headerRight: {
    minWidth: 44,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 12,
  },
  titleHit: {
    height: 44,
    maxWidth: '100%',
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 1,
  },
  circle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  controlFill: {
    flex: 1,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    minWidth: 0,
    flexShrink: 1,
    fontSize: 20,
    fontWeight: '500',
    textAlign: 'center',
  },
  failedWrap: {
    position: 'absolute',
    left: 16,
    right: 16,
    gap: 8,
    zIndex: 4,
  },
  failedBanner: {
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    overflow: 'hidden',
  },
  failedDot: { width: 8, height: 8, borderRadius: 4 },
  failedText: { fontSize: 14, flex: 1 },
  failedAction: { fontSize: 14, fontWeight: '600' },
  queueSheet: { padding: 20 },
  focusDim: {
    ...StyleSheet.absoluteFill,
    zIndex: 2,
  },
  focusDimDark: { backgroundColor: 'rgba(0,0,0,0.45)' },
  focusDimLight: { backgroundColor: 'rgba(0,0,0,0.28)' },
});
