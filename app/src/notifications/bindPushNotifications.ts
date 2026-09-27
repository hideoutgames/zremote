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
import {
  shouldLocalQuestionBanner,
  shouldNotifyOpenQuestion,
} from './questionAlert';
import { openQuestion } from '../zeron/protocol/detectQuestion';
import { getSessionStore } from '../zeron/state/sessionStores';
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
  // The first token fetch often fails while the app is still starting.
  // Retry when we come back to the foreground if we never registered.
  const appSub = AppState.addEventListener('change', next => {
    if (next === 'active' && lastToken === undefined) tick();
  });
  tick();

  const lastStatus = new Map<string, string | undefined>();
  /** chatId → last-seen open-question id. Absence of a key is the baseline
   * observation (a transcript that already ended on a question is not a
   * fresh alert). */
  const lastQuestion = new Map<string, string | undefined>();
  const notified = new Set<string>();
  const presentQuestion = (
    chatId: string,
    questionId: string,
    title: string,
  ): void => {
    const key = `${chatId}/${questionId}`;
    if (notified.has(key)) return;
    notified.add(key);
    Notifications.scheduleNotificationAsync({
      content: {
        title,
        body: t('notify.needsInput'),
        data: { chatId, url: `zeron://session/${chatId}` },
      },
      trigger: null,
    }).catch(e => log.warn(`question banner: ${e}`));
  };
  const scanQuestions = (leavingForeground = false): void => {
    if (cancelled || !uiPrefsStore.getState().notificationsEnabled) return;
    const { sessions, chats } = workspaceStore.getState();
    for (const row of Object.values(sessions)) {
      const prev = lastStatus.get(row.chatId);
      lastStatus.set(row.chatId, row.status);
      const chat = chats.find(c => c.id === row.chatId);
      const title = chat?.title ?? 'Session';
      const s = getSessionStore(row.chatId).getState();
      const open = openQuestion(s.entries, s.answeredQuestionIds);
      const observed = lastQuestion.has(row.chatId);
      const prevQuestion = lastQuestion.get(row.chatId);
      lastQuestion.set(row.chatId, open?.id);
      if (open === undefined) {
        notified.delete(`${row.chatId}/${prevQuestion ?? ''}`);
      }
      const noteKey = `${row.chatId}/${open?.id ?? ''}`;
      if (
        !leavingForeground &&
        shouldLocalQuestionBanner({
          prevStatus: prev,
          status: row.status,
          appState: AppState.currentState,
          selectedChatId: deps.selectedChatId(),
          chatId: row.chatId,
        })
      ) {
        if (open !== undefined) presentQuestion(row.chatId, open.id, title);
        else presentQuestion(row.chatId, 'status', title);
        continue;
      }
      // AskQuestion and the other unbrokered ask tools never flip the row
      // to awaitingInput, so the edge alert does not fire. A new question
      // id after the baseline does, including when the user locks the phone
      // while that thread is on screen (the panel is no longer visible).
      if (
        shouldNotifyOpenQuestion({
          baseline: !observed,
          alreadyNotified: notified.has(noteKey),
          questionId: open?.id,
          prevQuestionId: prevQuestion,
          kind: open?.kind,
          appState: AppState.currentState,
          selectedChatId: deps.selectedChatId(),
          chatId: row.chatId,
          leavingForeground,
        }) &&
        open !== undefined
      ) {
        presentQuestion(row.chatId, open.id, title);
      }
    }
  };
  let sessionUnsubs: (() => void)[] = [];
  const resubSessions = (): void => {
    for (const u of sessionUnsubs) u();
    // openQuestion reads per-chat entries — workspace ticks alone never
    // re-scan when a room's doc updates.
    // The listener receives the store state. scanQuestions's argument is
    // "the app is leaving the foreground", so it must not be the listener.
    sessionUnsubs = Object.keys(workspaceStore.getState().sessions).map(id =>
      getSessionStore(id).subscribe(() => scanQuestions()),
    );
  };
  const unsubWorkspace = workspaceStore.subscribe(() => {
    resubSessions();
    scanQuestions();
  });
  const leaveSub = AppState.addEventListener('change', next => {
    if (next === 'background' || next === 'inactive') scanQuestions(true);
  });
  resubSessions();
  scanQuestions();

  return () => {
    cancelled = true;
    unsubPrefs();
    unsubWorkspace();
    appSub.remove();
    leaveSub.remove();
    for (const u of sessionUnsubs) u();
    responseSub.remove();
    tokenSub.remove();
    unregister();
  };
};
