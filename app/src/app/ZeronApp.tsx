// App shell: builds the AuthSession once, binds it to authStore, constructs
// the per-account AppRuntime when signedIn, tears it down on sign-out or
// account change, routes AppState + deep links, and picks the top-level
// screen (SignIn / OrgGate / pager).

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AppState, StyleSheet, View } from 'react-native';
import { StatusBar } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AuthClient } from '../zeron/auth/authClient';
import { AuthSession } from '../zeron/auth/authSession';
import { bindAuthSession, useAuthStatus } from '../zeron/state/authStore';
import { expoSecureStore } from '../zeron/native/expoSecureStore';
import { appConfig } from '../zeron/native/appConfig';
import { deviceId, deviceName } from '../zeron/native/deviceIdentity';
import { createDocDisk } from '../zeron/native/expoDocDisk';
import { readFileBase64 } from '../zeron/native/fileBytes';
import { createLoroDoc } from '../zeron/native/loroPortFactory';
import { nitroWsFactory } from '../zeron/transport/nitroWs';
import { rnWsFactory } from '../zeron/transport/rnWs';
import Constants from 'expo-constants';
import { systemClock } from '../zeron/transport/clock';
import { getInitialUrl, addUrlListener } from '../zeron/native/authBrowser';
import { parseZeronLink } from '../zeron/protocol/edge';
import { AppRuntime } from '../zeron/runtime/appRuntime';
import { createLog } from '../zeron/log';
import { useTheme } from '../theme';
import { AppServicesContext, type AppServices } from './runtimeContext';
import { SignInScreen } from '../screens/SignInScreen';
import { OrgGateScreen } from '../screens/OrgGateScreen';
import { AdaptiveShell } from '../navigation/AdaptiveShell';

const log = createLog();

/** Expo Go (`storeClient`) ships no nitro modules: the built-in WebSocket
 * transport is used there, and the loro() probe in AppRuntime.create fails
 * → relay session mode. */
const isExpoGo = Constants.executionEnvironment === 'storeClient';
const wsFactory = isExpoGo ? rnWsFactory : nitroWsFactory;

export function ZeronApp() {
  const theme = useTheme();
  const status = useAuthStatus();

  // One AuthSession per edge URL (persisted record is namespaced by baseUrl).
  const cfg = useMemo(() => appConfig(), []);
  const auth = useMemo(
    () =>
      new AuthSession({
        client: new AuthClient({ baseUrl: cfg.edgeUrl }),
        store: expoSecureStore,
        baseUrl: cfg.edgeUrl,
        clientId: cfg.workosClientId,
        workosApiBase: cfg.workosApiBase,
        clock: systemClock,
      }),
    [cfg],
  );

  const edgeHost = useMemo(() => {
    try {
      return new URL(cfg.edgeUrl).host;
    } catch {
      return cfg.edgeUrl.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    }
  }, [cfg.edgeUrl]);

  useEffect(() => {
    const unbind = bindAuthSession(auth);
    auth.restore().catch(() => {});
    return unbind;
  }, [auth]);

  // ── Account-scoped runtime ────────────────────────────────────────────
  const [runtime, setRuntime] = useState<AppRuntime | null>(null);
  const accountRef = useRef<string | null>(null);

  const signedIn = status.state === 'signedIn' ? status : undefined;

  useEffect(() => {
    if (signedIn === undefined) {
      // Explicit sign-out already ran clearAccountCaches via signOut(); an
      // account change stops the old runtime without wiping the new account's
      // scope (DocDisk is account-isolated).
      const rt = runtime;
      setRuntime(null);
      accountRef.current = null;
      rt?.stop();
      return;
    }
    const key = `${signedIn.orgId}/${signedIn.user.id}`;
    if (accountRef.current === key) return;
    accountRef.current = key;
    let cancelled = false;
    (async () => {
      const id = await deviceId(expoSecureStore);
      const rt = await AppRuntime.create({
        cfg: { baseUrl: cfg.edgeUrl },
        tokenSource: auth,
        deviceId: id,
        deviceName: deviceName(),
        orgId: signedIn.orgId,
        userId: signedIn.user.id,
        wsFactory,
        clock: systemClock,
        docDisk: createDocDisk(),
        loro: createLoroDoc,
        readFileBase64,
        log: line => log.info(line),
      });
      if (cancelled) {
        rt.stop();
        return;
      }
      rt.start();
      setRuntime(rt);
    })().catch(e => log.error(`runtime create failed: ${e}`));
    const rt = runtime;
    return () => {
      cancelled = true;
      rt?.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn?.orgId, signedIn?.user.id]);

  // ── Live Activities (iOS; expo-widgets) — lazily imported so the JS
  // bundle still loads where the pod/module is absent.
  const selectedChatRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (runtime === null || signedIn === undefined) return;
    let unbind: (() => void) | undefined;
    import('../liveActivity/bindLiveActivities')
      .then(m => {
        unbind = m.bindLiveActivities({
          edgeUrl: cfg.edgeUrl,
          tokenSource: auth,
          orgId: signedIn.orgId,
          phoneDeviceId: runtime.deviceId,
          selectedChatId: () => selectedChatRef.current,
        });
      })
      .catch(e => log.warn(`live activities unavailable: ${e}`));
    return () => unbind?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runtime, signedIn?.orgId]);

  // ── AppState → foreground/background ──────────────────────────────────
  useEffect(() => {
    const sub = AppState.addEventListener('change', next => {
      if (next === 'active') runtime?.onForeground();
      else if (next === 'background' || next === 'inactive')
        runtime?.onBackground();
    });
    return () => sub.remove();
  }, [runtime]);

  // ── Deep links ─────────────────────────────────────────────────────────
  const [requestedChat, setRequestedChat] = useState<string | null>(null);
  const openSession = useCallback((chatId: string) => {
    setRequestedChat(chatId);
  }, []);
  useEffect(() => {
    selectedChatRef.current = requestedChat ?? undefined;
  }, [requestedChat]);

  useEffect(() => {
    const handle = (url: string | null) => {
      if (url === null) return;
      const link = parseZeronLink(url, edgeHost);
      if (link?.kind === 'session') openSession(link.chatId);
      else if (link?.kind === 'authCallback')
        auth
          .completeSignIn({ code: link.code, state: link.state })
          .catch(e => log.warn(`sign-in callback failed: ${e}`));
    };
    getInitialUrl()
      .then(handle)
      .catch(() => {});
    const sub = addUrlListener(handle);
    return () => sub.remove();
  }, [auth, edgeHost, openSession]);

  const signOut = useCallback(async () => {
    await auth.signOut();
    const rt = runtime;
    setRuntime(null);
    accountRef.current = null;
    if (rt !== null) await rt.clearAccountCaches();
  }, [auth, runtime]);

  const insets = useSafeAreaInsets();
  const services = useMemo<AppServices>(
    () => ({ auth, runtime, openSession, signOut }),
    [auth, runtime, openSession, signOut],
  );

  let body: React.ReactNode;
  if (status.state === 'signedOut') body = <SignInScreen />;
  else if (status.state === 'needsOrganization') body = <OrgGateScreen />;
  else body = <AdaptiveShell requestedChat={requestedChat} />;

  return (
    <AppServicesContext.Provider value={services}>
      <View
        style={[
          styles.root,
          {
            backgroundColor: theme.background,
            paddingTop: insets.top,
          },
        ]}
      >
        <StatusBar
          barStyle={theme.scheme === 'dark' ? 'light-content' : 'dark-content'}
          backgroundColor="transparent"
        />
        {body}
      </View>
    </AppServicesContext.Provider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
