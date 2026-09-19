// SessionScreen — the fork's ChatScreen shape driven by the synchronized
// session store: KeyboardAwareLegendList transcript, glass composer, scroll
// chevron, reasoning sheet, context-usage bar, failed-send banner.

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
  type LayoutChangeEvent,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardStickyView } from 'react-native-keyboard-controller';
import { type LegendListRef } from '@legendapp/list/react-native';
import {
  KeyboardAwareLegendList,
  useKeyboardChatComposerInset,
  useKeyboardScrollToEnd,
} from '@legendapp/list/keyboard';
import * as DropdownMenu from 'zeego/dropdown-menu';
import * as Clipboard from 'expo-clipboard';
import { useStore } from 'zustand';
import { useSessionState, useRunPhase } from '../zeron/state/sessionStores';
import { workspaceStore, useChat } from '../zeron/state/workspaceStore';
import { useDraft, setDraftPendingWorktree } from '../zeron/state/draftStore';
import {
  autoApproveFor,
  rememberModelPick,
  setPlanMode,
  toggleChatPinned,
  useChatPinned,
  useComposerExtraHeight,
  useRecentModels,
} from '../zeron/state/uiPrefs';
import {
  sessionTitle,
  hostLabel,
  checkoutLabel,
} from '../zeron/state/sessionTruth';
import {
  setChatArchived,
  setChatConfig,
  renameChat,
} from '../zeron/runtime/workspaceActions';
import { restoreFailedSend } from '../zeron/state/draftStore';
import { edgeFetchBytes } from '../zeron/transport/edgeHttp';
import { blobUrl } from '../zeron/transport/edge';
import {
  catalogStore,
  modelsFor,
  reasoningLevelsFor,
  selectableHarnesses,
} from '../zeron/state/catalogStore';
import { loadCatalog, loadModels } from '../zeron/runtime/catalog';
import { recentMenuModels } from '../zeron/state/recentModels';
import { capitalizeLevel } from '../components/effortSliderMath';
import {
  fastOffChoice,
  fastOnChoice,
  fastOptionForModel,
  isFastEnabled,
} from '../components/fastMode';
import { useCheckoutWatches } from '../hooks/useCheckoutWatches';
import { usePrBadge } from '../zeron/state/changeRequestStore';
import { useRuntime, useAuthSession } from '../app/runtimeContext';
import type { MessageEntry } from '../zeron/protocol/types';
import { Icon } from '../components/Icon';
import { Glass } from '../components/Glass';
import { Composer } from '../components/Composer';
import { ComposeComposer } from '../components/ComposeComposer';
import { ComposerChromeRow } from '../components/ComposerChromeRow';
import { EffortOverlay, type EffortOrigin } from '../components/EffortOverlay';
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
import { ThreadDetailsSheet } from '../components/ThreadDetailsSheet';
import { SubagentsSheet } from '../components/SubagentsSheet';
import { FileDiffSheet } from '../components/FileDiffSheet';
import type { FileDiffRequest } from '../components/FileDiffSheet';
import { ContextUsageBar } from '../components/agentsKit/ContextUsageBar';
import { ScrollToBottomButton } from '../components/ScrollToBottomButton';
import { useTheme } from '../theme';
import { t } from '../i18n/strings';
import { FilesScreen } from './FilesScreen';
import { TerminalScreen } from './TerminalScreen';
import { HistoryScreen } from './HistoryScreen';
import { createLog } from '../zeron/log';

const log = createLog();

const ReasoningSheet = React.lazy(() =>
  import('../components/ReasoningSheet').then(m => ({
    default: m.ReasoningSheet,
  })),
);

const ANCHOR_MAX_SIZE = 2 * 21 + 32;

// Do not add Reanimated worklets in this screen. React Compiler + worklets
// 0.10.x serializes a wide memo cache (props, runtime, Sets) and 0.10.1
// throws, which RCTFatal aborts in Release/TestFlight. Extract a tiny child
// if a worklet is required.

export function SessionScreen({
  chatId,
  onBack,
  onCreated,
  leadingIcon,
  contentMaxWidth,
  composerMaxWidth,
}: {
  chatId?: string;
  onBack: () => void;
  onCreated?: (chatId: string) => void;
  /** iPad split view: replaces the back chevron with a sidebar toggle. */
  leadingIcon?: string;
  /** iPad: cap the transcript measure (~720pt), centered. */
  contentMaxWidth?: number;
  /** iPad: cap the composer stack at 50% of the window width. */
  composerMaxWidth?: number;
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
  const insets = useSafeAreaInsets();
  const keyboardOffset = { opened: insets.bottom };
  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <View
        style={[styles.header, { paddingTop: insets.top + 6 }]}
        pointerEvents="box-none"
      >
        <Pressable
          onPress={onBack}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={
            leadingIcon !== undefined ? t('sidebar.toggle') : t('session.back')
          }
          style={styles.headerBtn}
        >
          <Glass interactive style={styles.circle}>
            <Icon
              name={(leadingIcon ?? 'chevron.left') as never}
              size={18}
              color={theme.text}
            />
          </Glass>
        </Pressable>
        <View style={styles.headerText}>
          <Glass style={styles.titlePill}>
            <Text
              style={[styles.title, { color: theme.text }]}
              numberOfLines={1}
            >
              {t('home.newThread')}
            </Text>
          </Glass>
        </View>
        <View style={styles.headerRight} />
      </View>
      <View style={styles.composeEmpty}>
        <Text style={[styles.empty, { color: theme.textSecondary }]}>
          {t('session.empty')}
        </Text>
      </View>
      <KeyboardStickyView offset={keyboardOffset} style={styles.composer}>
        <ComposeComposer
          autoFocus
          composerMaxWidth={composerMaxWidth}
          onCreated={id => onCreated?.(id)}
        />
      </KeyboardStickyView>
    </View>
  );
}

function ActiveSessionScreen({
  chatId,
  onBack,
  leadingIcon,
  contentMaxWidth,
  composerMaxWidth,
}: {
  chatId: string;
  onBack: () => void;
  leadingIcon?: string;
  contentMaxWidth?: number;
  composerMaxWidth?: number;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const runtime = useRuntime();
  const auth = useAuthSession();

  // retain on mount, release on unmount — the runtime closes the room only
  // when no view holds it.
  const controller = useMemo(
    () => (runtime === null ? undefined : runtime.openSession(chatId)),
    [runtime, chatId],
  );
  useEffect(() => {
    const c = controller?.retain();
    return () => {
      c?.release();
    };
  }, [controller]);

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

  const [composerHeight, setComposerHeight] = useState(0);
  const [showScrollDown, setShowScrollDown] = useState(false);
  const [reasoning, setReasoning] = useState<string | null>(null);
  const [following, setFollowing] = useState(false);
  const [anchorIndex, setAnchorIndex] = useState<number | undefined>(undefined);
  const hasOverflowedRef = useRef(false);
  const listRef = useRef<LegendListRef>(null);
  const composerRef = useRef<View>(null);

  const entries = session.entries;

  const openReasoning = useCallback((text: string) => setReasoning(text), []);

  const onFetchOutput = useCallback(
    (partId: string) => {
      if (runtime === null) return;
      edgeFetchBytes(blobUrl(runtime.cfg, chatId, partId), auth).catch(e =>
        log.warn(`blob fetch failed: ${e}`),
      );
    },
    [runtime, auth, chatId],
  );

  const renderEntry = useCallback(
    ({ item }: { item: MessageEntry }) =>
      item.role === 'user' ? (
        <UserMessage entry={item} chatId={chatId} />
      ) : (
        <AssistantMessage
          entry={item}
          phase={phase}
          onOpenReasoning={openReasoning}
          onFetchOutput={onFetchOutput}
          chatId={chatId}
          onOpenPlan={(name, markdown) => setPlanSheet({ name, markdown })}
          onOpenFileDiff={file => setFileDiff(file)}
        />
      ),
    [phase, openReasoning, onFetchOutput, chatId],
  );

  const { contentInsetEndAdjustment, onComposerLayout: reportComposerInset } =
    useKeyboardChatComposerInset(listRef, composerRef);
  const { freeze, scrollMessageToEnd } = useKeyboardScrollToEnd({ listRef });
  const extraHeight = useComposerExtraHeight();

  const onComposerLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const height = event.nativeEvent.layout.height;
      setComposerHeight(height);
      reportComposerInset({
        ...event,
        nativeEvent: {
          ...event.nativeEvent,
          layout: {
            ...event.nativeEvent.layout,
            height: Math.max(0, height - extraHeight),
          },
        },
      });
    },
    [reportComposerInset, extraHeight],
  );

  const doSend = useCallback(
    (text: string) => {
      if (controller === undefined) return;
      const wt = draft.pendingWorktree;
      controller.sendRun(
        text,
        { config: chat?.config, cwd: chat?.cwd },
        {
          autoApprove: autoApproveFor(chatId),
          ...(wt !== undefined ? { worktree: wt } : {}),
        },
      );
      if (wt !== undefined) setDraftPendingWorktree(chatId, undefined);
      setAnchorIndex(entries.length);
      hasOverflowedRef.current = false;
      setFollowing(false);
      scrollMessageToEnd({ animated: entries.length > 0, closeKeyboard: true });
    },
    [
      controller,
      draft.pendingWorktree,
      chat,
      chatId,
      entries.length,
      scrollMessageToEnd,
    ],
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
          autoApprove: autoApproveFor(chatId),
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
      chatId,
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
  const [effortOpen, setEffortOpen] = useState(false);
  const [effortOrigin, setEffortOrigin] = useState<EffortOrigin | undefined>(
    undefined,
  );
  const [prSheet, setPrSheet] = useState<PrBadgeModel | null>(null);
  const [composerFocused, setComposerFocused] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
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
  const catalogTick = catalog?.loadedAt ?? 0;
  const catalogModels = useMemo(() => {
    if (hostDeviceId === undefined) return [];
    const out: { harness: string; model: string; label: string }[] = [];
    for (const h of selectableHarnesses(hostDeviceId)) {
      for (const m of modelsFor(hostDeviceId, h.id)) {
        out.push({ harness: h.id, model: m.id, label: m.label });
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hostDeviceId, catalogTick]);
  const currentHarness = chat?.config?.harness;
  const currentModelId = chat?.config?.model;
  const recentItems = useMemo(
    () =>
      recentMenuModels(
        recents,
        catalogModels,
        currentHarness !== undefined && currentModelId !== undefined
          ? { harness: currentHarness, model: currentModelId }
          : undefined,
        3,
      ),
    [recents, catalogModels, currentHarness, currentModelId],
  );
  const effortLevels =
    hostDeviceId === undefined || chat?.config?.harness === undefined
      ? []
      : reasoningLevelsFor(
          hostDeviceId,
          chat.config.harness,
          chat.config.model,
        );
  const currentModel =
    hostDeviceId === undefined || chat?.config?.harness === undefined
      ? undefined
      : modelsFor(hostDeviceId, chat.config.harness).find(
          m => m.id === chat.config?.model,
        );
  const fastOption = fastOptionForModel(currentModel);
  const fastEnabled = isFastEnabled(chat?.config?.modelOptions, fastOption);
  const modelLabel =
    currentModel?.label ?? chat?.config?.model ?? t('picker.default');
  const effortLabel = capitalizeLevel(
    chat?.config?.reasoning ?? effortLevels[0] ?? t('picker.effort'),
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
  const prBadge = usePrBadge(chatId);
  const keyboardOffset = { opened: insets.bottom };
  const subtitle = [hostLabel(chat, host ? [host] : []), checkoutLabel(chat)]
    .filter(Boolean)
    .join(' · ');

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <KeyboardAwareLegendList
        ref={listRef}
        style={styles.fill}
        data={entries}
        keyExtractor={(item: MessageEntry) => item.id}
        renderItem={renderEntry}
        applyWorkaroundForContentInsetHitTestBug
        maintainVisibleContentPosition={
          Platform.OS !== 'android'
            ? undefined
            : anchorIndex != null && !following
        }
        keyboardLiftBehavior="whenAtEnd"
        keyboardOffset={insets.bottom}
        contentInsetEndAdjustment={contentInsetEndAdjustment}
        freeze={freeze}
        anchoredEndSpace={
          anchorIndex != null
            ? {
                anchorIndex,
                anchorMaxSize: ANCHOR_MAX_SIZE,
                anchorOffset: insets.top + 56,
                onSizeChanged: size => {
                  if (size <= 0 && !hasOverflowedRef.current) {
                    hasOverflowedRef.current = true;
                    setFollowing(true);
                  }
                },
              }
            : undefined
        }
        maintainScrollAtEnd={
          following ? { on: { dataChange: true, itemLayout: true } } : undefined
        }
        maintainScrollAtEndThreshold={1}
        estimatedItemSize={64}
        estimatedListSize={{ width: windowWidth, height: windowHeight }}
        onEndVisible={v => {
          setShowScrollDown(!v);
          if (v && hasOverflowedRef.current) setFollowing(true);
        }}
        onScrollBeginDrag={() => {
          if (hasOverflowedRef.current) setFollowing(false);
        }}
        contentContainerStyle={[
          styles.listContent,
          { paddingTop: insets.top + 96 },
          contentMaxWidth !== undefined
            ? [styles.measureCap, { maxWidth: contentMaxWidth }]
            : undefined,
        ]}
        scrollIndicatorInsets={{ top: insets.top + 96 }}
        keyboardDismissMode="interactive"
        ListEmptyComponent={
          <Text style={[styles.empty, { color: theme.textSecondary }]}>
            {t('session.empty')}
          </Text>
        }
      />

      {/* Header: back, title (tap → rename), subtitle host · branch, overflow.
          box-none: taps in the transparent gaps reach the transcript. */}
      <View
        style={[styles.header, { paddingTop: insets.top + 6 }]}
        pointerEvents="box-none"
      >
        <Pressable
          onPress={onBack}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={
            leadingIcon !== undefined ? t('sidebar.toggle') : t('session.back')
          }
          style={styles.headerBtn}
        >
          <Glass interactive style={styles.circle}>
            <Icon
              name={(leadingIcon ?? 'chevron.left') as never}
              size={18}
              color={theme.text}
            />
          </Glass>
        </Pressable>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger>
            <Pressable
              style={styles.headerText}
              hitSlop={4}
              accessibilityRole="button"
              accessibilityLabel={t('session.titleMenu')}
            >
              <Glass style={styles.titlePill}>
                <Text
                  style={[styles.title, { color: theme.text }]}
                  numberOfLines={1}
                >
                  {sessionTitle(chat)}
                </Text>
                {subtitle !== '' ? (
                  <Text
                    style={[styles.subtitle, { color: theme.textSecondary }]}
                    numberOfLines={1}
                  >
                    {subtitle}
                  </Text>
                ) : null}
              </Glass>
            </Pressable>
          </DropdownMenu.Trigger>
          <DropdownMenu.Content>
            <DropdownMenu.Item key="rename" onSelect={onRename}>
              <DropdownMenu.ItemTitle>
                {t('session.rename')}
              </DropdownMenu.ItemTitle>
            </DropdownMenu.Item>
            <DropdownMenu.Item key="pin" onSelect={onPin}>
              <DropdownMenu.ItemTitle>
                {pinned ? t('session.unpin') : t('session.pin')}
              </DropdownMenu.ItemTitle>
            </DropdownMenu.Item>
            <DropdownMenu.Item key="archive" onSelect={onArchive}>
              <DropdownMenu.ItemTitle>
                {chat?.archived
                  ? t('home.row.unarchive')
                  : t('session.archive')}
              </DropdownMenu.ItemTitle>
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Root>
        <View style={styles.headerRight}>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger>
              <Glass
                interactive
                style={styles.circle}
                accessibilityRole="button"
                accessibilityLabel={t('session.overflow')}
              >
                <Icon name="ellipsis.circle" size={18} color={theme.text} />
              </Glass>
            </DropdownMenu.Trigger>
            <DropdownMenu.Content>
              <DropdownMenu.Item
                key="details"
                onSelect={() => setDetailsOpen(true)}
              >
                <DropdownMenu.ItemTitle>
                  {t('session.details')}
                </DropdownMenu.ItemTitle>
              </DropdownMenu.Item>
              <DropdownMenu.Item
                key="subagents"
                onSelect={() => setSubagentsOpen(true)}
              >
                <DropdownMenu.ItemTitle>
                  {t('session.subagents')}
                </DropdownMenu.ItemTitle>
              </DropdownMenu.Item>
              <DropdownMenu.Item
                key="history"
                onSelect={() => setToolSheet('history')}
              >
                <DropdownMenu.ItemTitle>
                  {t('session.history')}
                </DropdownMenu.ItemTitle>
              </DropdownMenu.Item>
              <DropdownMenu.Item
                key="files"
                onSelect={() => setToolSheet('files')}
              >
                <DropdownMenu.ItemTitle>
                  {t('session.files')}
                </DropdownMenu.ItemTitle>
              </DropdownMenu.Item>
              <DropdownMenu.Item
                key="terminal"
                onSelect={() => setToolSheet('terminal')}
              >
                <DropdownMenu.ItemTitle>
                  {t('session.terminal')}
                </DropdownMenu.ItemTitle>
              </DropdownMenu.Item>
              <DropdownMenu.Item key="copy" onSelect={onCopyId}>
                <DropdownMenu.ItemTitle>
                  {t('session.copyId')}
                </DropdownMenu.ItemTitle>
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Root>
        </View>
      </View>

      {composerFocused ? (
        <Pressable
          style={[
            styles.focusDim,
            theme.scheme === 'dark'
              ? styles.focusDimDark
              : styles.focusDimLight,
          ]}
          onPress={() => Keyboard.dismiss()}
          accessibilityRole="button"
          accessibilityLabel={t('composer.dismissKeyboard')}
        />
      ) : null}

      <ContextUsageBar usage={session.meta.contextUsage} />

      {session.failedSends.map(f => (
        <View
          key={f.messageId}
          style={[styles.failedBanner, { borderColor: theme.danger }]}
        >
          <Text style={[styles.failedText, { color: theme.danger }]}>
            {`${t('session.failedSend')} (${t(
              `session.failedSend.${f.status}`,
            )})`}
          </Text>
          <Pressable
            onPress={() => restoreFailedSend(chatId, f.text)}
            hitSlop={6}
          >
            <Text style={[styles.failedAction, { color: theme.accent }]}>
              {t('session.restoreDraft')}
            </Text>
          </Pressable>
        </View>
      ))}

      <KeyboardStickyView
        offset={keyboardOffset}
        style={[styles.scrollDown, { bottom: composerHeight + 10 }]}
        pointerEvents="box-none"
      >
        {showScrollDown ? (
          <ScrollToBottomButton
            onPress={() =>
              scrollMessageToEnd({ animated: true, closeKeyboard: false })
            }
          />
        ) : null}
      </KeyboardStickyView>

      <KeyboardStickyView offset={keyboardOffset} style={styles.composer}>
        <View
          style={
            composerMaxWidth !== undefined
              ? [styles.measureCap, { maxWidth: composerMaxWidth }]
              : undefined
          }
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
              setChatConfig(runtime, chat.id, {
                harness: h,
                model: m,
                modelOptions: chat.config?.modelOptions ?? {},
                reasoning: chat.config?.reasoning,
                sandbox: chat.config?.sandbox,
              });
              rememberModelPick({ harness: h, model: m });
            }}
            onOpenMoreModels={() => setPickerOpen(true)}
            effortLabel={effortLabel}
            effortSupported={effortLevels.length > 0}
            fastSupported={fastOption !== undefined}
            fastEnabled={fastEnabled}
            effortOpen={effortOpen}
            onOpenEffort={origin => {
              Keyboard.dismiss();
              setEffortOrigin(origin);
              setEffortOpen(true);
            }}
            onToggleFast={on => {
              if (
                runtime === null ||
                chat === undefined ||
                fastOption === undefined
              )
                return;
              setChatConfig(runtime, chat.id, {
                harness: chat.config?.harness ?? '',
                model: chat.config?.model,
                reasoning: chat.config?.reasoning,
                sandbox: chat.config?.sandbox,
                modelOptions: {
                  ...(chat.config?.modelOptions ?? {}),
                  [fastOption.id]: on
                    ? fastOnChoice(fastOption)
                    : fastOffChoice(fastOption),
                },
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
            composerRef={composerRef}
            onLayout={onComposerLayout}
          />
        </View>
      </KeyboardStickyView>

      {effortOpen ? (
        <EffortOverlay
          levels={effortLevels}
          value={chat?.config?.reasoning}
          origin={effortOrigin}
          onChange={level => {
            if (runtime === null || chat === undefined) return;
            setChatConfig(runtime, chat.id, {
              harness: chat.config?.harness ?? '',
              model: chat.config?.model,
              modelOptions: chat.config?.modelOptions ?? {},
              reasoning: level,
              sandbox: chat.config?.sandbox,
            });
          }}
          onDismiss={() => {
            setEffortOpen(false);
            setEffortOrigin(undefined);
          }}
        />
      ) : null}

      {queueOpen ? (
        <GlassSheet
          title={t('queue.title')}
          onDismiss={() => setQueueOpen(false)}
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
            doSend('Implement the plan.');
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
          <HistoryScreen chatId={chatId} onOpenPr={setPrSheet} />
        </SessionSheet>
      ) : null}
      {toolSheet === 'files' ? (
        <SessionSheet
          title={t('session.files')}
          fill
          onDismiss={() => setToolSheet(null)}
        >
          <FilesScreen chatId={chatId} />
        </SessionSheet>
      ) : null}
      {toolSheet === 'terminal' ? (
        <SessionSheet
          title={t('session.terminal')}
          fill
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
  fill: { flex: 1 },
  composer: { position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 3 },
  scrollDown: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  listContent: { paddingBottom: 4 },
  empty: { fontSize: 15, textAlign: 'center', padding: 32 },
  composeEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 8,
    zIndex: 3,
  },
  measureCap: { width: '100%', alignSelf: 'center' },
  headerBtn: { minWidth: 44, minHeight: 44, justifyContent: 'center' },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  titlePill: {
    alignItems: 'center',
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: 4,
    maxWidth: '100%',
    overflow: 'hidden',
  },
  circle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  headerText: { flex: 1, alignItems: 'center' },
  title: { fontSize: 17, fontWeight: '600' },
  subtitle: { fontSize: 12 },
  failedBanner: {
    position: 'absolute',
    bottom: 120,
    left: 16,
    right: 16,
    borderWidth: 1,
    borderRadius: 12,
    padding: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  failedText: { fontSize: 13, flex: 1 },
  failedAction: { fontSize: 13, fontWeight: '600' },
  queueSheet: { padding: 20 },
  focusDim: {
    ...StyleSheet.absoluteFill,
    zIndex: 2,
  },
  focusDimDark: { backgroundColor: 'rgba(0,0,0,0.45)' },
  focusDimLight: { backgroundColor: 'rgba(0,0,0,0.28)' },
});
