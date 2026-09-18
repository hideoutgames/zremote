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
  type LayoutChangeEvent,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';
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
import BootSplash from 'react-native-bootsplash';
import { useSessionState, useRunPhase } from '../zeron/state/sessionStores';
import { workspaceStore, useChat } from '../zeron/state/workspaceStore';
import { useDraft, setDraftPendingWorktree } from '../zeron/state/draftStore';
import { autoApproveFor } from '../zeron/state/uiPrefs';
import {
  sessionTitle,
  hostLabel,
  checkoutLabel,
} from '../zeron/state/sessionTruth';
import { setChatArchived, renameChat } from '../zeron/runtime/workspaceActions';
import { restoreFailedSend } from '../zeron/state/draftStore';
import { edgeFetchBytes } from '../zeron/transport/edgeHttp';
import { blobUrl } from '../zeron/transport/edge';
import { catalogStore } from '../zeron/state/catalogStore';
import { loadCatalog } from '../zeron/runtime/catalog';
import { useRuntime, useAuthSession } from '../app/runtimeContext';
import type { MessageEntry } from '../zeron/protocol/types';
import { Icon } from '../components/Icon';
import { Glass, GlassContainer } from '../components/Glass';
import { Composer } from '../components/Composer';
import { CheckoutSelector } from '../components/CheckoutSelector';
import { QueuePanel } from '../components/QueuePanel';
import { ModelPickerSheet } from '../components/ModelPickerSheet';
import { TrueSheet } from '@lodev09/react-native-true-sheet';
import {
  dictationUnavailable,
  resolveDictationPort,
} from '../zeron/native/dictation';
import type { DictationPort } from '../zeron/native/dictation';
import { CAP_QUEUE_ACTIONS } from '../zeron/attachments/sendPlan';
import type { SendPlan } from '../zeron/attachments/sendPlan';
import { UserMessage } from '../components/transcript/UserMessage';
import { AssistantMessage } from '../components/transcript/AssistantMessage';
import { ContextUsageBar } from '../components/agentsKit/ContextUsageBar';
import { ScrollToBottomButton } from '../components/ScrollToBottomButton';
import { useTheme } from '../theme';
import { t } from '../i18n/strings';
import { ChangesScreen } from './ChangesScreen';
import { FilesScreen } from './FilesScreen';
import { TerminalScreen } from './TerminalScreen';
import { HistoryScreen } from './HistoryScreen';
import { PreviewsScreen } from './PreviewsScreen';
import { createLog } from '../zeron/log';

const log = createLog();

const ReasoningSheet = React.lazy(() =>
  import('../components/ReasoningSheet').then(m => ({
    default: m.ReasoningSheet,
  })),
);

const ANCHOR_MAX_SIZE = 2 * 21 + 32;

export function SessionScreen({
  chatId,
  onBack,
  leadingIcon,
  contentMaxWidth,
  leadingInsetSV,
  onToggleInspector,
}: {
  chatId: string;
  onBack: () => void;
  /** iPad split view: replaces the back chevron with a sidebar toggle. */
  leadingIcon?: string;
  /** iPad: cap the transcript/composer measure (~720pt), centered. */
  contentMaxWidth?: number;
  /** iPad: animated leading inset under the floating sidebar — applied to
   * the header and composer measure only; the transcript scrolls under. */
  leadingInsetSV?: SharedValue<number>;
  /** iPad: shows an inspector toggle in the header. */
  onToggleInspector?: () => void;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const fallbackInset = useSharedValue(0);
  const leadingPad = useAnimatedStyle(() => ({
    paddingLeft: (leadingInsetSV ?? fallbackInset).value,
  }));
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
        />
      ),
    [phase, openReasoning, onFetchOutput, chatId],
  );

  const { contentInsetEndAdjustment, onComposerLayout: reportComposerInset } =
    useKeyboardChatComposerInset(listRef, composerRef);
  const { freeze, scrollMessageToEnd } = useKeyboardScrollToEnd({ listRef });

  const onComposerLayout = useCallback(
    (event: LayoutChangeEvent) => {
      setComposerHeight(event.nativeEvent.layout.height);
      reportComposerInset(event);
    },
    [reportComposerInset],
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
  const [toolOverlay, setToolOverlay] = useState<
    'changes' | 'files' | 'terminal' | 'history' | 'previews' | null
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
  const modelLabel = `${harness?.name ?? t('picker.agent')} · ${
    chat?.config?.model ?? t('picker.default')
  }`;
  const keyboardOffset = { opened: insets.bottom };
  const subtitle = [hostLabel(chat, host ? [host] : []), checkoutLabel(chat)]
    .filter(Boolean)
    .join(' · ');

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <BootSplash.HideOnDraw fade />

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
      <Animated.View
        style={[styles.header, { paddingTop: insets.top + 6 }, leadingPad]}
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
        <Pressable
          style={styles.headerText}
          onPress={onRename}
          hitSlop={4}
          accessibilityRole="button"
          accessibilityLabel={t('session.rename')}
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
        <GlassContainer spacing={8} style={styles.headerRight}>
          {onToggleInspector !== undefined ? (
            <Pressable
              onPress={onToggleInspector}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={t('inspector.toggle')}
              style={styles.headerBtn}
            >
              <Glass interactive style={styles.circle}>
                <Icon
                  name={'sidebar.right' as never}
                  size={18}
                  color={theme.text}
                />
              </Glass>
            </Pressable>
          ) : null}
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
                key="changes"
                onSelect={() => setToolOverlay('changes')}
              >
                <DropdownMenu.ItemTitle>
                  {t('session.changes')}
                </DropdownMenu.ItemTitle>
              </DropdownMenu.Item>
              <DropdownMenu.Item
                key="files"
                onSelect={() => setToolOverlay('files')}
              >
                <DropdownMenu.ItemTitle>
                  {t('session.files')}
                </DropdownMenu.ItemTitle>
              </DropdownMenu.Item>
              <DropdownMenu.Item
                key="terminal"
                onSelect={() => setToolOverlay('terminal')}
              >
                <DropdownMenu.ItemTitle>
                  {t('session.terminal')}
                </DropdownMenu.ItemTitle>
              </DropdownMenu.Item>
              <DropdownMenu.Item
                key="history"
                onSelect={() => setToolOverlay('history')}
              >
                <DropdownMenu.ItemTitle>
                  {t('session.history')}
                </DropdownMenu.ItemTitle>
              </DropdownMenu.Item>
              <DropdownMenu.Item
                key="previews"
                onSelect={() => setToolOverlay('previews')}
              >
                <DropdownMenu.ItemTitle>
                  {t('session.previews')}
                </DropdownMenu.ItemTitle>
              </DropdownMenu.Item>
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
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Root>
        </GlassContainer>
      </Animated.View>

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
        <Animated.View
          style={[
            contentMaxWidth !== undefined
              ? [styles.measureCap, { maxWidth: contentMaxWidth }]
              : undefined,
            leadingPad,
          ]}
        >
          {runtime !== null && chat !== undefined ? (
            <CheckoutSelector
              runtime={runtime}
              chat={chat}
              host={host}
              phase={phase}
              repoPath={space?.path}
              label={subtitle !== '' ? subtitle : t('checkout.noProject')}
            />
          ) : null}
          <Composer
            chatId={chatId}
            phase={phase}
            roomState={session.room}
            harness={harness}
            capabilities={capabilities}
            modelLabel={modelLabel}
            onOpenModelPicker={() => setPickerOpen(true)}
            onOpenQueue={() => setQueueOpen(true)}
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
        </Animated.View>
      </KeyboardStickyView>

      {queueOpen ? (
        <TrueSheet
          detents={['auto', 1]}
          initialDetentIndex={0}
          onDidDismiss={() => setQueueOpen(false)}
          grabber
          backgroundColor={theme.background}
        >
          <View style={styles.queueSheet}>
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
            />
          </View>
        </TrueSheet>
      ) : null}

      {pickerOpen && runtime !== null && chat !== undefined ? (
        <ModelPickerSheet
          runtime={runtime}
          chat={chat}
          phase={phase}
          hasMessages={entries.length > 0}
          onClose={() => setPickerOpen(false)}
          formSheet={windowWidth >= 700}
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

      {toolOverlay !== null ? (
        <View
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: theme.background },
          ]}
        >
          <View
            style={[
              styles.overlayBar,
              { paddingTop: insets.top + 6, borderBottomColor: theme.border },
            ]}
          >
            <Pressable
              onPress={() => setToolOverlay(null)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={t('session.back')}
              style={styles.headerBtn}
            >
              <View
                style={[
                  styles.circle,
                  { backgroundColor: theme.cardBackground },
                ]}
              >
                <Icon name="chevron.left" size={18} color={theme.text} />
              </View>
            </Pressable>
            <Text style={[styles.title, { color: theme.text }]}>
              {toolOverlay === 'changes'
                ? t('session.changes')
                : toolOverlay === 'files'
                ? t('session.files')
                : toolOverlay === 'terminal'
                ? t('session.terminal')
                : toolOverlay === 'history'
                ? t('session.history')
                : t('session.previews')}
            </Text>
          </View>
          <View style={styles.fill}>
            {toolOverlay === 'changes' ? (
              <ChangesScreen
                chatId={chatId}
                onOpenHistory={() => setToolOverlay('history')}
              />
            ) : toolOverlay === 'files' ? (
              <FilesScreen chatId={chatId} />
            ) : toolOverlay === 'terminal' ? (
              <TerminalScreen chatId={chatId} />
            ) : toolOverlay === 'history' ? (
              <HistoryScreen chatId={chatId} />
            ) : (
              <PreviewsScreen chatId={chatId} />
            )}
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  fill: { flex: 1 },
  composer: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  scrollDown: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  listContent: { paddingBottom: 4 },
  empty: { fontSize: 15, textAlign: 'center', padding: 32 },
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
  overlayBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
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
});
