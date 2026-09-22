// Runtime wiring: permission + native APNs device token → edge registry,
// foreground presentation policy, tap → open session.
//
// IMPLEMENTED-BUT-UNVERIFIED on device: needs a signed build and APNS_*
// on the deployed edge (docs/HOST_EDGE_CHANGES.md §4).

import { AppState } from 'react-native';
import * as Notifications from 'expo-notifications';
import {
  registerAlertPushToken,
  unregisterAlertPushToken,
} from '../zeron/transport/pushTokenRegistry';
import type { TokenSource } from '../zeron/transport/tokenSource';
import { uiPrefsStore } from '../zeron/state/uiPrefs';
import { createLog } from '../zeron/log';
import { chatIdFromData, shouldPresentBanner } from './presentation';
import { shouldLocalQuestionBanner } from './questionAlert';
import { openQuestion } from '../zeron/protocol/detectQuestion';
import { getSessionStore, runPhase } from '../zeron/state/sessionStores';
import { t } from '../i18n/strings';
import { workspaceStore } from '../zeron/state/workspaceStore';

const log = createLog();

export type BindPushDeps = {
  edgeUrl: string;
  tokenSource: TokenSource;
  orgId: string;
  phoneDeviceId: string;
  selectedChatId(): string | undefined;
  openSession(chatId: string): void;
};

const registration = (
  token: string,
  device: string,
): {
  chatId: '*';
  token: string;
  kind: 'alert';
  device: string;
} => ({ chatId: '*', token, kind: 'alert', device });

/** Returns an unbind function. Settings toggle off → DELETE the token. */
export const bindPushNotifications = (deps: BindPushDeps): (() => void) => {
  try {
    return bindPushNotificationsUnsafe(deps);
  } catch (e) {
    log.warn(`alert-push bind failed: ${e}`);
    return () => {};
  }
};

const bindPushNotificationsUnsafe = (deps: BindPushDeps): (() => void) => {
  let lastToken: string | undefined;
  let cancelled = false;

  Notifications.setNotificationHandler({
    handleNotification: async notification => {
      const chatId = chatIdFromData(notification.request.content.data);
      const show = shouldPresentBanner({
        appState: AppState.currentState,
        selectedChatId: deps.selectedChatId(),
        notificationChatId: chatId,
      });
      return {
        shouldShowBanner: show,
        shouldShowList: show,
        shouldPlaySound: show,
        shouldSetBadge: false,
      };
    },
  });

  const openFrom = (data: unknown): void => {
    const chatId = chatIdFromData(data);
    if (chatId !== undefined) deps.openSession(chatId);
  };

  const responseSub = Notifications.addNotificationResponseReceivedListener(
    resp => openFrom(resp.notification.request.content.data),
  );

  Notifications.getLastNotificationResponseAsync()
    .then(resp => {
      if (cancelled || resp === null) return;
      openFrom(resp.notification.request.content.data);
    })
    .catch(() => {});

  const tokenSub = Notifications.addPushTokenListener(token => {
    const data = token.data;
    if (typeof data !== 'string' || data.length === 0) return;
    lastToken = data;
    if (!uiPrefsStore.getState().notificationsEnabled) return;
    registerAlertPushToken(
      deps.edgeUrl,
      deps.tokenSource,
      deps.orgId,
      registration(data, deps.phoneDeviceId),
    ).catch(e => log.warn(`alert-push register: ${e}`));
  });

  const unregister = (): void => {
    const token = lastToken;
    lastToken = undefined;
    if (token === undefined) return;
    unregisterAlertPushToken(
      deps.edgeUrl,
      deps.tokenSource,
      deps.orgId,
      registration(token, deps.phoneDeviceId),
    ).catch(e => log.warn(`alert-push unregister: ${e}`));
  };

  const tick = (): void => {
    if (cancelled) return;
    if (!uiPrefsStore.getState().notificationsEnabled) {
      unregister();
      return;
    }
    (async () => {
      const perm = await Notifications.requestPermissionsAsync();
      if (cancelled || perm.status !== 'granted') return;
      const tok = await Notifications.getDevicePushTokenAsync();
      if (cancelled) return;
      if (typeof tok.data !== 'string' || tok.data.length === 0) return;
      lastToken = tok.data;
      await registerAlertPushToken(
        deps.edgeUrl,
        deps.tokenSource,
        deps.orgId,
        registration(tok.data, deps.phoneDeviceId),
      );
    })().catch(e => log.warn(`alert-push bind: ${e}`));
  };

  let lastEnabled = uiPrefsStore.getState().notificationsEnabled;
  const unsubPrefs = uiPrefsStore.subscribe(s => {
    if (s.notificationsEnabled === lastEnabled) return;
    lastEnabled = s.notificationsEnabled;
    tick();
  });
  tick();

  const lastStatus = new Map<string, string | undefined>();
  /** chatId → last-seen open-question id; the app-detected counterpart of
   * lastStatus (host flips). Absence of a key marks the first observation. */
  const lastQuestion = new Map<string, string | undefined>();
  const presentQuestion = (chatId: string, title: string): void => {
    Notifications.scheduleNotificationAsync({
      content: {
        title,
        body: t('notify.needsInput'),
        data: { chatId, url: `zeron://session/${chatId}` },
      },
      trigger: null,
    }).catch(e => log.warn(`question banner: ${e}`));
  };
  const scanQuestions = (): void => {
    if (cancelled || !uiPrefsStore.getState().notificationsEnabled) return;
    const { sessions, chats } = workspaceStore.getState();
    const now = Date.now();
    for (const row of Object.values(sessions)) {
      const prev = lastStatus.get(row.chatId);
      lastStatus.set(row.chatId, row.status);
      const chat = chats.find(c => c.id === row.chatId);
      const s = getSessionStore(row.chatId).getState();
      const open = openQuestion(s.entries, s.answeredQuestionIds);
      const observed = lastQuestion.has(row.chatId);
      const prevQuestion = lastQuestion.get(row.chatId);
      lastQuestion.set(row.chatId, open?.id);
      if (
        shouldLocalQuestionBanner({
          prevStatus: prev,
          status: row.status,
          appState: AppState.currentState,
          selectedChatId: deps.selectedChatId(),
          chatId: row.chatId,
        })
      ) {
        presentQuestion(row.chatId, chat?.title ?? 'Session');
        continue;
      }
      // App-detected questions never flip the row — the host mints no
      // `input` part for unbrokered ask tools (opencode `question`, hermes
      // `clarify`, grok's ACP method, …). Mirror the Live Activity parity:
      // a new open-question id fires the same "needs input" banner when the
      // phase machine flags the run (awaitingInput), or when an already
      // observed idle thread surfaces one — first-seen idle questions seed
      // silently (a stale transcript tail is not fresh input need).
      const phase = runPhase(s, row, chat, deps.phoneDeviceId, now);
      const fresh = phase === 'awaitingInput' || (phase === 'idle' && observed);
      if (
        open !== undefined &&
        open.id !== prevQuestion &&
        fresh &&
        shouldPresentBanner({
          appState: AppState.currentState,
          selectedChatId: deps.selectedChatId(),
          notificationChatId: row.chatId,
        })
      ) {
        presentQuestion(row.chatId, chat?.title ?? 'Session');
      }
    }
  };
  let sessionUnsubs: (() => void)[] = [];
  const resubSessions = (): void => {
    for (const u of sessionUnsubs) u();
    // openQuestion reads per-chat entries — workspace ticks alone never
    // re-scan when a room's doc updates.
    sessionUnsubs = Object.keys(workspaceStore.getState().sessions).map(id =>
      getSessionStore(id).subscribe(scanQuestions),
    );
  };
  const unsubWorkspace = workspaceStore.subscribe(() => {
    resubSessions();
    scanQuestions();
  });
  resubSessions();
  scanQuestions();

  return () => {
    cancelled = true;
    unsubPrefs();
    unsubWorkspace();
    for (const u of sessionUnsubs) u();
    responseSub.remove();
    tokenSub.remove();
    unregister();
  };
};
