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

  return () => {
    cancelled = true;
    unsubPrefs();
    responseSub.remove();
    tokenSub.remove();
    unregister();
  };
};
