// Settings: inset-grouped account, desktops, and prefs. Per-desktop page
// covers rename, software update, session titles, agent accounts, harnesses.

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { useStore } from 'zustand';
import { workspaceStore } from '../zeron/state/workspaceStore';
import { authStore } from '../zeron/state/authStore';
import { catalogStore } from '../zeron/state/catalogStore';
import { loadCatalog, setHarnessEnabled } from '../zeron/runtime/catalog';
import { useAppServices, useRuntime } from '../app/runtimeContext';
import type {
  DeviceRow,
  TitleSettings,
  UpdateStatus,
} from '../zeron/protocol/types';
import { METHODS } from '../zeron/protocol/rpc';
import { AgentAccountsScreen } from './AgentAccountsScreen';
import { Icon } from '../components/Icon';
import {
  SettingsGroup,
  SettingsInputRow,
  SettingsRow,
  settingsPageBackground,
} from '../components/settings/SettingsList';
import { useTheme } from '../theme';
import { useDemoMode } from '../demo/demoMode';
import { t } from '../i18n/strings';
import { createLog } from '../zeron/log';
import {
  setForceRelayMode,
  setHapticsEnabled,
  setLiveActivitiesEnabled,
  setLiveActivityShowHost,
  setNotificationsEnabled,
  useDictationLocale,
  useForceRelayMode,
  useHapticsEnabled,
  useLiveActivitiesEnabled,
  useLiveActivityShowHost,
  useNotificationsEnabled,
} from '../zeron/state/uiPrefs';
import {
  dictationUnavailable,
  resolveDictationPort,
} from '../zeron/native/dictation';
import type { DictationModelState } from '../../modules/zeron-dictation/src/Dictation.nitro';
import {
  AppearanceBackground,
  ThemePage,
} from '../components/settings/AppearanceBackground';

const log = createLog();

const PRESENCE_TTL_MS = 45_000;
const PRESENCE_TICK_MS = 5_000;

const useNow = (intervalMs: number): number => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
};

const dictationStateLabel = (s: DictationModelState): string =>
  s === 'installed'
    ? t('settings.dictationInstalled')
    : s === 'downloadable'
    ? t('settings.dictationDownloadable')
    : s === 'downloading'
    ? t('settings.dictationDownloading')
    : t('settings.dictationUnsupported');

const AgentsPage = ({ device }: { device: DeviceRow }) => {
  const theme = useTheme();
  const runtime = useRuntime();
  const catalog = useStore(catalogStore, s => s.byDevice[device.id]);
  const [update, setUpdate] = useState<UpdateStatus | undefined>(undefined);
  const [applying, setApplying] = useState(false);
  const [title, setTitle] = useState<TitleSettings>({});
  const [titleLoaded, setTitleLoaded] = useState(false);

  useEffect(() => {
    if (runtime !== null)
      loadCatalog(runtime, device.id, { allowMockHarness: true }).catch(e =>
        log.warn(`catalog: ${e}`),
      );
  }, [runtime, device.id]);

  useEffect(() => {
    if (runtime === null) return;
    let cancelled = false;
    let stream: { cancel(): void } | undefined;
    runtime
      .relayFor(device.id)
      .stream<UpdateStatus>(METHODS.UPDATE_STATUS, {})
      .then(async s => {
        if (cancelled) {
          s.cancel();
          return;
        }
        stream = s;
        for await (const u of s.items) if (!cancelled) setUpdate(u);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      stream?.cancel();
    };
  }, [runtime, device.id]);

  useEffect(() => {
    if (runtime === null) return;
    runtime
      .relayFor(device.id)
      .call<TitleSettings>(METHODS.GET_TITLE_SETTINGS, {})
      .then(s => {
        setTitle(s);
        setTitleLoaded(true);
      })
      .catch(() => {});
  }, [runtime, device.id]);

  const saveTitle = useCallback(
    (next: TitleSettings) => {
      setTitle(next);
      runtime
        ?.relayFor(device.id)
        .call(METHODS.SET_TITLE_SETTINGS, { ...next })
        .catch(e => log.warn(`SetTitleSettings: ${e}`));
    },
    [runtime, device.id],
  );

  const rename = useCallback(() => {
    Alert.prompt(
      t('settings.renameDevice'),
      undefined,
      text => {
        const name = text.trim();
        if (name === '' || runtime === null) return;
        runtime
          .relayFor(device.id)
          .call(METHODS.MUTATE, {
            op: 'renameDevice',
            deviceId: device.id,
            name,
          })
          .catch(e => log.warn(`renameDevice: ${e}`));
      },
      'plain-text',
      device.name,
    );
  }, [runtime, device.id, device.name]);

  const applyUpdate = useCallback(() => {
    if (runtime === null || applying) return;
    Alert.alert(
      t('settings.softwareUpdate'),
      t('settings.updateApplyConfirm'),
      [
        { text: t('home.row.cancel'), style: 'cancel' },
        {
          text: t('settings.updateApply'),
          onPress: () => {
            setApplying(true);
            runtime
              .relayFor(device.id)
              .call(METHODS.APPLY_UPDATE, {})
              .catch(e => log.warn(`ApplyUpdate: ${e}`))
              .finally(() => setApplying(false));
          },
        },
      ],
    );
  }, [runtime, device.id, applying]);

  const toggle = useCallback(
    (harnessId: string, enabled: boolean) => {
      if (runtime === null) return;
      setHarnessEnabled(runtime, device.id, harnessId, enabled, {
        allowMockHarness: true,
      }).catch(e => log.warn(`setHarnessEnabled: ${e}`));
    },
    [runtime, device.id],
  );

  return (
    <View>
      <SettingsGroup>
        <SettingsRow
          title={t('settings.deviceName')}
          value={device.name}
          showChevron
          onPress={rename}
          accessibilityLabel={t('settings.renameDevice')}
        />
      </SettingsGroup>

      {update !== undefined ? (
        <SettingsGroup footer={update.error}>
          <SettingsRow
            title={t('settings.softwareUpdate')}
            value={
              update.updateAvailable
                ? t('settings.updateAvailable')
                : t('settings.upToDate')
            }
            trailing={
              update.updateAvailable ? (
                applying ? (
                  <ActivityIndicator size="small" />
                ) : (
                  <Text style={[styles.apply, { color: theme.accent }]}>
                    {t('settings.updateApply')}
                  </Text>
                )
              ) : undefined
            }
            onPress={
              update.updateAvailable && !applying ? applyUpdate : undefined
            }
            accessibilityLabel={t('settings.softwareUpdate')}
          />
        </SettingsGroup>
      ) : null}

      {titleLoaded ? (
        <SettingsGroup header={t('settings.titleSettings')}>
          <SettingsInputRow
            label={t('settings.titleHarness')}
            value={title.harness ?? ''}
            onChangeText={v => saveTitle({ ...title, harness: v || undefined })}
            placeholder={t('settings.titleHarness')}
          />
          <SettingsInputRow
            label={t('settings.titleModel')}
            value={title.model ?? ''}
            onChangeText={v => saveTitle({ ...title, model: v || undefined })}
            placeholder={t('settings.titleModel')}
          />
        </SettingsGroup>
      ) : null}

      <View style={styles.embeddedHeader}>
        <Text style={[styles.embeddedCaption, { color: theme.textSecondary }]}>
          {t('settings.agentAccounts')}
        </Text>
      </View>
      <AgentAccountsScreen deviceId={device.id} />

      <SettingsGroup header={t('settings.agents')}>
        {catalog === undefined || catalog.loading ? (
          <View style={styles.centeredRow}>
            <ActivityIndicator color={theme.textSecondary} />
          </View>
        ) : catalog.error !== undefined ? (
          <View style={styles.centeredRow}>
            <Text style={[styles.error, { color: theme.danger }]}>
              {catalog.error}
            </Text>
          </View>
        ) : (
          catalog.harnesses.map(h => (
            <SettingsRow
              key={h.id}
              title={h.name}
              subtitle={
                h.installed === false ? t('settings.notInstalled') : undefined
              }
              trailing={
                <Switch
                  value={h.enabled !== false}
                  disabled={h.installed === false}
                  onValueChange={v => toggle(h.id, v)}
                  accessibilityLabel={h.name}
                />
              }
            />
          ))
        )}
      </SettingsGroup>
    </View>
  );
};

export function SettingsScreen({ onClose }: { onClose: () => void }) {
  const theme = useTheme();
  const { signOut } = useAppServices();
  const status = useStore(authStore, s => s.status);
  const devices = useStore(workspaceStore, s => s.devices);
  const presence = useStore(workspaceStore, s => s.presence);
  const now = useNow(PRESENCE_TICK_MS);
  const [agentsFor, setAgentsFor] = useState<DeviceRow | undefined>(undefined);
  const [themeOpen, setThemeOpen] = useState(false);
  const liveActivities = useLiveActivitiesEnabled();
  const liveActivityShowHost = useLiveActivityShowHost();
  const notificationsEnabled = useNotificationsEnabled();
  const hapticsEnabled = useHapticsEnabled();
  const forceRelayMode = useForceRelayMode();
  const dictationLocale = useDictationLocale();
  const [dictationModelState, setDictationModelState] = useState<
    DictationModelState | undefined
  >(undefined);

  useEffect(() => {
    let mounted = true;
    resolveDictationPort()
      .then(port =>
        port === dictationUnavailable
          ? undefined
          : (
              port as typeof dictationUnavailable & {
                modelState(l: string): Promise<DictationModelState>;
              }
            ).modelState(dictationLocale),
      )
      .then(state => {
        if (mounted && state !== undefined) setDictationModelState(state);
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, [dictationLocale]);

  const downloadDictationModel = useCallback(() => {
    resolveDictationPort()
      .then(port =>
        (
          port as typeof dictationUnavailable & {
            downloadModel(
              l: string,
              p: (progress: number) => void,
            ): Promise<void>;
          }
        ).downloadModel(dictationLocale, () => {}),
      )
      .then(() => setDictationModelState('installed'))
      .catch(e => log.warn(`dictation model: ${e}`));
  }, [dictationLocale]);

  const user =
    status.state === 'signedIn' || status.state === 'needsOrganization'
      ? status.user
      : undefined;

  const demoActive = useDemoMode();

  const confirmSignOut = useCallback(() => {
    if (demoActive) {
      signOut().catch(e => log.warn(`signOut: ${e}`));
      onClose();
      return;
    }
    Alert.alert(t('settings.signOut'), t('settings.signOutConfirm'), [
      { text: t('home.row.cancel'), style: 'cancel' },
      {
        text: t('settings.signOut'),
        style: 'destructive',
        onPress: () => {
          signOut().catch(e => log.warn(`signOut: ${e}`));
          onClose();
        },
      },
    ]);
  }, [signOut, onClose, demoActive]);

  const deviceConnected = (id: string): boolean => {
    const at = presence[id];
    return at !== undefined && now - at < PRESENCE_TTL_MS;
  };

  const accountTitle = demoActive
    ? t('settings.demoAccount')
    : user?.email ?? user?.id ?? '';

  const dictationFooter =
    dictationModelState === undefined
      ? t('settings.dictationUnavailable')
      : dictationStateLabel(dictationModelState);

  return (
    <View
      style={[styles.root, { backgroundColor: settingsPageBackground(theme) }]}
    >
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          {agentsFor !== undefined || themeOpen ? (
            <Pressable
              onPress={() => {
                if (agentsFor !== undefined) setAgentsFor(undefined);
                else setThemeOpen(false);
              }}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={t('settings.title')}
              style={styles.backBtn}
            >
              <Icon name="chevron.left" size={17} color={theme.accent} />
              <Text style={[styles.backLabel, { color: theme.accent }]}>
                {t('settings.title')}
              </Text>
            </Pressable>
          ) : null}
        </View>
        <Text style={[styles.title, { color: theme.text }]} numberOfLines={1}>
          {agentsFor !== undefined
            ? agentsFor.name
            : themeOpen
            ? t('settings.theme')
            : t('settings.title')}
        </Text>
        <View style={styles.headerRight}>
          <Pressable
            onPress={onClose}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t('common.done')}
            style={styles.doneHit}
          >
            <Text style={[styles.done, { color: theme.accent }]}>
              {t('common.done')}
            </Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.body}>
        <ScrollView
          contentContainerStyle={styles.content}
          contentInsetAdjustmentBehavior="automatic"
          keyboardShouldPersistTaps="handled"
        >
          {agentsFor !== undefined ? (
            <AgentsPage device={agentsFor} />
          ) : themeOpen ? (
            <ThemePage />
          ) : (
            <>
              <SettingsGroup header={t('settings.account')}>
                <SettingsRow
                  title={accountTitle}
                  leading={
                    <Icon
                      name="person.crop.circle"
                      size={28}
                      color={theme.textSecondary}
                    />
                  }
                  testID="settings-account"
                  accessibilityLabel={accountTitle}
                />
              </SettingsGroup>

              <SettingsGroup>
                <SettingsRow
                  title={
                    demoActive ? t('settings.exitDemo') : t('settings.signOut')
                  }
                  destructive
                  onPress={confirmSignOut}
                  testID="settings-sign-out"
                />
              </SettingsGroup>

              {devices.length > 0 ? (
                <SettingsGroup header={t('settings.devices')}>
                  {devices.map(d => {
                    const connected = deviceConnected(d.id);
                    const subtitle = connected
                      ? t('settings.connected')
                      : t('settings.notConnected');
                    return (
                      <SettingsRow
                        key={d.id}
                        title={d.name}
                        subtitle={subtitle}
                        leading={
                          <Icon
                            name="externaldrive"
                            size={22}
                            color={theme.textSecondary}
                          />
                        }
                        showChevron
                        onPress={() => setAgentsFor(d)}
                        testID={`settings-device-${d.id}`}
                        accessibilityLabel={`${d.name}, ${subtitle}`}
                      />
                    );
                  })}
                </SettingsGroup>
              ) : null}

              <SettingsGroup
                header={t('settings.notifications')}
                footer={t('settings.notificationsHint')}
              >
                <SettingsRow
                  title={t('settings.notifications')}
                  trailing={
                    <Switch
                      value={notificationsEnabled}
                      onValueChange={setNotificationsEnabled}
                      accessibilityLabel={t('settings.notifications')}
                    />
                  }
                />
              </SettingsGroup>

              <SettingsGroup header={t('settings.haptics')}>
                <SettingsRow
                  title={t('settings.haptics')}
                  trailing={
                    <Switch
                      value={hapticsEnabled}
                      onValueChange={setHapticsEnabled}
                      accessibilityLabel={t('settings.haptics')}
                    />
                  }
                />
              </SettingsGroup>

              <AppearanceBackground onOpenTheme={() => setThemeOpen(true)} />

              <SettingsGroup
                header={t('settings.liveActivities')}
                footer={t('settings.liveActivityHint')}
              >
                <SettingsRow
                  title={t('settings.liveActivities')}
                  trailing={
                    <Switch
                      value={liveActivities}
                      onValueChange={setLiveActivitiesEnabled}
                      accessibilityLabel={t('settings.liveActivities')}
                    />
                  }
                />
                <SettingsRow
                  title={t('settings.liveActivityShowHost')}
                  trailing={
                    <Switch
                      value={liveActivityShowHost}
                      onValueChange={setLiveActivityShowHost}
                      accessibilityLabel={t('settings.liveActivityShowHost')}
                    />
                  }
                />
              </SettingsGroup>

              <SettingsGroup
                header={t('settings.syncMode')}
                footer={t('settings.syncModeHint')}
              >
                <SettingsRow
                  title={t('settings.syncModeRelay')}
                  trailing={
                    <Switch
                      value={forceRelayMode}
                      onValueChange={setForceRelayMode}
                      accessibilityLabel={t('settings.syncModeRelay')}
                    />
                  }
                />
              </SettingsGroup>

              <SettingsGroup
                header={t('settings.dictation')}
                footer={dictationFooter}
              >
                <SettingsRow
                  title={t('settings.dictationLanguage')}
                  value={dictationLocale}
                  trailing={
                    dictationModelState === 'downloadable' ? (
                      <Pressable
                        onPress={downloadDictationModel}
                        hitSlop={8}
                        accessibilityRole="button"
                        accessibilityLabel={t('settings.dictationDownload')}
                      >
                        <Icon
                          name="arrow.down.circle"
                          size={22}
                          color={theme.accent}
                        />
                      </Pressable>
                    ) : undefined
                  }
                />
              </SettingsGroup>
            </>
          )}
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    height: 52,
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  title: {
    fontSize: 17,
    fontWeight: '600',
    textAlign: 'center',
    marginHorizontal: 88,
  },
  headerLeft: {
    position: 'absolute',
    left: 8,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
    minWidth: 44,
  },
  headerRight: {
    position: 'absolute',
    right: 16,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'flex-end',
    minWidth: 44,
  },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
    paddingHorizontal: 4,
  },
  backLabel: { fontSize: 17 },
  doneHit: { minHeight: 44, justifyContent: 'center' },
  done: { fontSize: 17, fontWeight: '600' },
  body: { flex: 1 },
  content: { paddingTop: 8, paddingBottom: 40 },
  apply: { fontSize: 17 },
  embeddedHeader: {
    marginHorizontal: 16,
    paddingHorizontal: 16,
    paddingBottom: 6,
  },
  embeddedCaption: { fontSize: 13 },
  centeredRow: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  error: { fontSize: 15 },
});
