// Settings: inset-grouped account, desktops, and prefs. Per-desktop page
// covers rename, software update, agent accounts, harnesses.

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
import * as Haptics from 'expo-haptics';
import { workspaceStore } from '../zeron/state/workspaceStore';
import { authStore } from '../zeron/state/authStore';
import { catalogStore } from '../zeron/state/catalogStore';
import { loadCatalog, setHarnessEnabled } from '../zeron/runtime/catalog';
import {
  APPLY_RESTART_WAIT_MS,
  APPLY_UPDATE_TIMEOUT_MS,
  UPDATE_STATUS_RETRY_MS,
  updateInstalled,
} from '../zeron/runtime/softwareUpdate';
import { useAppServices, useRuntime } from '../app/runtimeContext';
import { isPresenceFresh } from '../zeron/protocol/entities';
import type { DeviceRow, UpdateStatus } from '../zeron/protocol/types';
import { METHODS } from '../zeron/protocol/rpc';
import { AgentAccountsScreen } from './AgentAccountsScreen';
import { Icon } from '../components/Icon';
import {
  SettingsGroup,
  SettingsRow,
  settingsPageBackground,
} from '../components/settings/SettingsList';
import { useTheme } from '../theme';
import { t } from '../i18n/strings';
import { createLog } from '../zeron/log';
import { impact } from '../zeron/native/haptics';
import {
  setForceRelayMode,
  setHapticsEnabled,
  setLiveActivitiesEnabled,
  setLiveActivityShowHost,
  setLocalLogsEnabled,
  setNotificationsEnabled,
  useCleanupModelId,
  useDictationLocale,
  useForceRelayMode,
  useHapticsEnabled,
  useLiveActivitiesEnabled,
  useLiveActivityShowHost,
  useLocalLogsEnabled,
  useNotificationsEnabled,
  useVoiceInputMode,
  useVoiceModelId,
} from '../zeron/state/uiPrefs';
import { deleteLocalLogs } from '../zeron/diagnostics/localLogs';
import { LocalLogsScreen } from './LocalLogsScreen';
import { SessionSheet } from '../components/SessionSheet';
import {
  dictationUnavailable,
  resolveDictationPort,
} from '../zeron/native/dictation';
import type { DictationModelState } from '../../modules/zeron-dictation/src/Dictation.nitro';
import {
  AppearanceBackground,
  ThemePage,
} from '../components/settings/AppearanceBackground';
import {
  VoiceInputPage,
  voiceInputModeLabel,
} from '../components/settings/VoiceInputPage';
import {
  VoiceModelPicker,
  selectedModelLabel,
} from '../components/settings/VoiceModelPicker';
import { CleanupPromptEditor } from '../components/settings/CleanupPromptEditor';
import { catalogEntry } from '../zeron/voice/catalog';

const log = createLog();

const PRESENCE_TICK_MS = 5_000;

type SettingsPage =
  | 'root'
  | 'theme'
  | 'voiceInput'
  | 'voiceModel'
  | 'cleanupModel'
  | 'cleanupPrompt';

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
  const [applyError, setApplyError] = useState<string | undefined>(undefined);
  /** Version ApplyUpdate reported. The spinner stays up until the restarted
   * host publishes it, or the restart wait expires. */
  const [pendingVersion, setPendingVersion] = useState<string | undefined>(
    undefined,
  );

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
    let retry: ReturnType<typeof setTimeout> | undefined;

    const open = async () => {
      try {
        const s = await runtime
          .relayFor(device.id)
          .stream<UpdateStatus>(METHODS.UPDATE_STATUS, {});
        if (cancelled) {
          s.cancel();
          return;
        }
        stream = s;
        try {
          for await (const u of s.items) {
            if (cancelled) break;
            setUpdate(u);
          }
        } finally {
          if (stream === s) stream = undefined;
        }
      } catch {
        // The restart drops the relay. Re-subscribe below; status payloads
        // stay off the log.
      }
      if (cancelled) return;
      retry = setTimeout(() => {
        retry = undefined;
        open().catch(() => {});
      }, UPDATE_STATUS_RETRY_MS);
    };

    open().catch(() => {});
    return () => {
      cancelled = true;
      if (retry !== undefined) clearTimeout(retry);
      stream?.cancel();
    };
  }, [runtime, device.id]);

  useEffect(() => {
    if (
      pendingVersion === undefined ||
      update === undefined ||
      !updateInstalled(update, pendingVersion)
    ) {
      return;
    }
    setPendingVersion(undefined);
    setApplyError(undefined);
    setApplying(false);
  }, [pendingVersion, update]);

  useEffect(() => {
    if (pendingVersion === undefined) return;
    const id = setTimeout(() => {
      setPendingVersion(undefined);
      setApplying(false);
    }, APPLY_RESTART_WAIT_MS);
    return () => clearTimeout(id);
  }, [pendingVersion]);

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
            setApplyError(undefined);
            runtime
              .relayFor(device.id)
              .call<{ version?: string }>(
                METHODS.APPLY_UPDATE,
                {},
                { timeoutMs: APPLY_UPDATE_TIMEOUT_MS },
              )
              .then(result => {
                const version = result?.version?.trim();
                if (version === undefined || version === '') {
                  setApplying(false);
                  return;
                }
                setPendingVersion(version);
              })
              .catch(e => {
                log.warn(`ApplyUpdate: ${e}`);
                setPendingVersion(undefined);
                setApplyError(e instanceof Error ? e.message : String(e));
                setApplying(false);
              });
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
        <SettingsGroup footer={applyError ?? update.error}>
          <SettingsRow
            title={t('settings.softwareUpdate')}
            value={
              applying
                ? t('settings.updateApplying')
                : update.updateAvailable
                ? t('settings.updateAvailable')
                : t('settings.upToDate')
            }
            trailing={
              applying ? (
                <ActivityIndicator
                  size="small"
                  accessibilityLabel={t('settings.updateApplying')}
                  testID="software-update-spinner"
                />
              ) : update.updateAvailable ? (
                <Text style={[styles.apply, { color: theme.accent }]}>
                  {t('settings.updateApply')}
                </Text>
              ) : undefined
            }
            onPress={
              update.updateAvailable && !applying ? applyUpdate : undefined
            }
            accessibilityLabel={t('settings.softwareUpdate')}
            testID="settings-software-update"
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
  const [page, setPage] = useState<SettingsPage>('root');
  const [logsOpen, setLogsOpen] = useState(false);
  const liveActivities = useLiveActivitiesEnabled();
  const liveActivityShowHost = useLiveActivityShowHost();
  const notificationsEnabled = useNotificationsEnabled();
  const hapticsEnabled = useHapticsEnabled();
  const forceRelayMode = useForceRelayMode();
  const localLogsEnabled = useLocalLogsEnabled();
  const dictationLocale = useDictationLocale();
  const voiceInputMode = useVoiceInputMode();
  const voiceModelId = useVoiceModelId();
  const cleanupModelId = useCleanupModelId();
  const cleanupEngine = catalogEntry(cleanupModelId);
  const [dictationModelState, setDictationModelState] = useState<
    DictationModelState | undefined
  >(undefined);

  useEffect(() => {
    if (voiceInputMode !== 'dictation') {
      setDictationModelState(undefined);
      return;
    }
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
  }, [dictationLocale, voiceInputMode]);

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

  const onLocalLogsChange = useCallback((next: boolean) => {
    if (next) {
      setLocalLogsEnabled(true).catch(() => {});
      return;
    }
    Alert.alert(
      t('settings.localLogsDisableTitle'),
      t('settings.localLogsDisableBody'),
      [
        { text: t('home.row.cancel'), style: 'cancel' },
        {
          text: t('settings.localLogsDisable'),
          style: 'destructive',
          onPress: () => {
            setLocalLogsEnabled(false).catch(() => {});
            deleteLocalLogs().catch(() => {});
          },
        },
      ],
    );
  }, []);

  const confirmSignOut = useCallback(() => {
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
  }, [signOut, onClose]);

  const deviceConnected = (id: string): boolean =>
    isPresenceFresh(presence[id], now);

  const accountTitle = user?.email ?? user?.id ?? '';

  const subpageOpen = agentsFor !== undefined || page !== 'root';
  const pageTitle =
    agentsFor !== undefined
      ? agentsFor.name
      : page === 'theme'
      ? t('settings.theme')
      : page === 'voiceInput'
      ? t('settings.voiceInput')
      : page === 'voiceModel'
      ? t('settings.voiceModel')
      : page === 'cleanupModel'
      ? t('settings.cleanupModel')
      : page === 'cleanupPrompt'
      ? t('settings.cleanupInstructions')
      : t('settings.title');

  return (
    <View
      style={[styles.root, { backgroundColor: settingsPageBackground(theme) }]}
    >
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          {subpageOpen ? (
            <Pressable
              onPress={() => {
                if (agentsFor !== undefined) setAgentsFor(undefined);
                else setPage('root');
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
          {pageTitle}
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
          ) : page === 'theme' ? (
            <ThemePage />
          ) : page === 'voiceInput' ? (
            <VoiceInputPage />
          ) : page === 'voiceModel' ? (
            <VoiceModelPicker kind="transcription" />
          ) : page === 'cleanupModel' ? (
            <VoiceModelPicker kind="cleanup" />
          ) : page === 'cleanupPrompt' ? (
            <CleanupPromptEditor onClose={() => setPage('root')} />
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
                  title={t('settings.signOut')}
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

              <SettingsGroup
                header={t('settings.haptics')}
                footer={t('settings.hapticsHint')}
              >
                <SettingsRow
                  title={t('settings.haptics')}
                  trailing={
                    <Switch
                      value={hapticsEnabled}
                      onValueChange={v => {
                        setHapticsEnabled(v);
                        if (v) impact(Haptics.ImpactFeedbackStyle.Medium);
                      }}
                      accessibilityLabel={t('settings.haptics')}
                    />
                  }
                />
              </SettingsGroup>

              <AppearanceBackground onOpenTheme={() => setPage('theme')} />

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
                header={t('settings.voiceInput')}
                footer={
                  voiceInputMode === 'dictation'
                    ? dictationModelState === undefined
                      ? t('settings.dictationUnavailable')
                      : dictationStateLabel(dictationModelState)
                    : undefined
                }
              >
                <SettingsRow
                  title={t('settings.voiceInput')}
                  value={voiceInputModeLabel(voiceInputMode)}
                  showChevron
                  onPress={() => setPage('voiceInput')}
                  testID="settings-voice-input"
                  accessibilityLabel={`${t(
                    'settings.voiceInput',
                  )}, ${voiceInputModeLabel(voiceInputMode)}`}
                />
                {voiceInputMode === 'dictation' ? (
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
                    testID="settings-dictation-language"
                  />
                ) : null}
                {voiceInputMode === 'voiceModel' ? (
                  <SettingsRow
                    title={t('settings.voiceModel')}
                    value={
                      voiceModelId === null
                        ? t('settings.voiceRequired')
                        : selectedModelLabel(voiceModelId)
                    }
                    showChevron
                    onPress={() => setPage('voiceModel')}
                    testID="settings-voice-model"
                  />
                ) : null}
                {voiceInputMode === 'voiceModel' ? (
                  <SettingsRow
                    title={t('settings.cleanupModel')}
                    value={selectedModelLabel(cleanupModelId)}
                    showChevron
                    onPress={() => setPage('cleanupModel')}
                    testID="settings-cleanup-model"
                  />
                ) : null}
                {voiceInputMode === 'voiceModel' &&
                cleanupEngine?.capabilities.supportsCustomPrompt === true ? (
                  <SettingsRow
                    title={t('settings.cleanupInstructions')}
                    showChevron
                    onPress={() => setPage('cleanupPrompt')}
                    testID="settings-cleanup-instructions"
                  />
                ) : null}
              </SettingsGroup>

              <SettingsGroup
                header={t('settings.debug')}
                footer={t('settings.localLogsHint')}
              >
                <SettingsRow
                  title={t('settings.localLogs')}
                  trailing={
                    <Switch
                      value={localLogsEnabled}
                      onValueChange={onLocalLogsChange}
                      accessibilityLabel={t('settings.localLogs')}
                      testID="settings-local-logs"
                    />
                  }
                />
                {localLogsEnabled ? (
                  <SettingsRow
                    title={t('settings.viewLocalLogs')}
                    showChevron
                    onPress={() => setLogsOpen(true)}
                    testID="settings-view-local-logs"
                  />
                ) : null}
              </SettingsGroup>
            </>
          )}
        </ScrollView>
        {logsOpen ? (
          <SessionSheet fill onDismiss={() => setLogsOpen(false)}>
            <LocalLogsScreen />
          </SessionSheet>
        ) : null}
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
