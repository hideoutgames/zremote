// Settings: account card, sign-out (confirm → clearAccountCaches), device
// list, per-device Agents page (ListHarnesses + enable toggles), read-only
// edge URL.
//
// TODO(later): agent accounts, shortcuts, archived-sessions management.

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useStore } from 'zustand';
import { workspaceStore } from '../zeron/state/workspaceStore';
import { authStore } from '../zeron/state/authStore';
import { catalogStore } from '../zeron/state/catalogStore';
import { loadCatalog, setHarnessEnabled } from '../zeron/runtime/catalog';
import { appConfig } from '../zeron/native/appConfig';
import { useAppServices, useRuntime } from '../app/runtimeContext';
import type {
  DeviceRow,
  TitleSettings,
  UpdateStatus,
} from '../zeron/protocol/types';
import { METHODS } from '../zeron/protocol/rpc';
import { AgentAccountsScreen } from './AgentAccountsScreen';
import { Icon } from '../components/Icon';
import { useTheme } from '../theme';
import { useDemoMode } from '../demo/demoMode';
import { t } from '../i18n/strings';
import { createLog } from '../zeron/log';
import {
  setForceRelayMode,
  setLiveActivitiesEnabled,
  setLiveActivityShowHost,
  useDictationLocale,
  useForceRelayMode,
  useLiveActivitiesEnabled,
  useLiveActivityShowHost,
} from '../zeron/state/uiPrefs';
import {
  dictationUnavailable,
  resolveDictationPort,
} from '../zeron/native/dictation';
import type { DictationModelState } from '../../modules/zeron-dictation/src/Dictation.nitro';

const log = createLog();

const dictationStateLabel = (s: DictationModelState): string =>
  s === 'installed'
    ? t('settings.dictationInstalled')
    : s === 'downloadable'
    ? t('settings.dictationDownloadable')
    : s === 'downloading'
    ? t('settings.dictationDownloading')
    : t('settings.dictationUnsupported');

const AgentsPage = ({
  device,
  onBack,
}: {
  device: DeviceRow;
  onBack: () => void;
}) => {
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

  // UpdateStatus is a stream whose first item is the current status
  // (rpc.rs L1625 watch_stream). Errors mean updates unavailable.
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

  // Per-device title settings (registry.rs TitleSettings: harness + model).
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
    if (runtime === null) return;
    Alert.alert(t('settings.updateApply'), t('settings.updateApplyConfirm'), [
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
    ]);
  }, [runtime, device.id]);

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
    <View style={styles.page}>
      <Pressable onPress={onBack} hitSlop={8} style={styles.backRow}>
        <Icon name="chevron.left" size={16} color={theme.accent} />
        <Text style={[styles.back, { color: theme.accent }]}>
          {device.name}
        </Text>
      </Pressable>

      {/* Rename + version/capabilities/last-seen are in the row subtitle on
          the parent list; rename via Mutate op renameDevice (rpc.rs L895). */}
      <Pressable
        onPress={rename}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={t('settings.renameDevice')}
        style={styles.agentRowBtn}
      >
        <Text style={[styles.agentName, { color: theme.accent }]}>
          {t('settings.renameDevice')}
        </Text>
      </Pressable>

      {update !== undefined ? (
        <View
          style={[
            styles.agentRow,
            {
              backgroundColor: theme.cardBackground,
              borderColor: theme.border,
            },
          ]}
        >
          <View style={styles.agentText}>
            <Text style={[styles.agentName, { color: theme.text }]}>
              {`v${update.currentVersion}`}
              {update.updateAvailable && update.latestVersion !== undefined
                ? ` → v${update.latestVersion}`
                : ''}
            </Text>
            {update.error !== undefined ? (
              <Text style={[styles.agentSub, { color: theme.danger }]}>
                {update.error}
              </Text>
            ) : null}
          </View>
          {update.updateAvailable ? (
            <Pressable
              onPress={applyUpdate}
              disabled={applying}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={t('settings.updateApply')}
            >
              {applying ? (
                <ActivityIndicator size="small" />
              ) : (
                <Text style={{ color: theme.accent }}>
                  {t('settings.updateApply')}
                </Text>
              )}
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {titleLoaded ? (
        <View
          style={[
            styles.agentRow,
            {
              backgroundColor: theme.cardBackground,
              borderColor: theme.border,
            },
          ]}
        >
          <View style={styles.agentText}>
            <Text style={[styles.agentName, { color: theme.text }]}>
              {t('settings.titleSettings')}
            </Text>
            <TextInput
              value={title.harness ?? ''}
              onChangeText={v =>
                saveTitle({ ...title, harness: v || undefined })
              }
              placeholder={t('settings.titleHarness')}
              placeholderTextColor={theme.textSecondary}
              autoCapitalize="none"
              autoCorrect={false}
              style={[styles.titleInput, { color: theme.text }]}
              accessibilityLabel={t('settings.titleHarness')}
            />
            <TextInput
              value={title.model ?? ''}
              onChangeText={v => saveTitle({ ...title, model: v || undefined })}
              placeholder={t('settings.titleModel')}
              placeholderTextColor={theme.textSecondary}
              autoCapitalize="none"
              autoCorrect={false}
              style={[styles.titleInput, { color: theme.text }]}
              accessibilityLabel={t('settings.titleModel')}
            />
          </View>
        </View>
      ) : null}

      <Text style={[styles.section, { color: theme.textSecondary }]}>
        {t('settings.agentAccounts')}
      </Text>
      <AgentAccountsScreen deviceId={device.id} />

      <Text style={[styles.section, { color: theme.textSecondary }]}>
        {t('settings.agents')}
      </Text>
      {catalog === undefined || catalog.loading ? (
        <ActivityIndicator color={theme.textSecondary} />
      ) : catalog.error !== undefined ? (
        <Text style={[styles.error, { color: theme.danger }]}>
          {catalog.error}
        </Text>
      ) : (
        catalog.harnesses.map(h => (
          <View
            key={h.id}
            style={[
              styles.agentRow,
              {
                backgroundColor: theme.cardBackground,
                borderColor: theme.border,
              },
            ]}
          >
            <View style={styles.agentText}>
              <Text style={[styles.agentName, { color: theme.text }]}>
                {h.name}
              </Text>
              {h.installed === false ? (
                <Text style={[styles.agentSub, { color: theme.textSecondary }]}>
                  {'not installed'}
                </Text>
              ) : null}
            </View>
            <Switch
              value={h.enabled !== false}
              disabled={h.installed === false}
              onValueChange={v => toggle(h.id, v)}
            />
          </View>
        ))
      )}
    </View>
  );
};

export function SettingsScreen({ onClose }: { onClose: () => void }) {
  const theme = useTheme();
  const { signOut } = useAppServices();
  const status = useStore(authStore, s => s.status);
  const devices = useStore(workspaceStore, s => s.devices);
  const presence = useStore(workspaceStore, s => s.presence);
  const edgeUrl = appConfig().edgeUrl;
  const [agentsFor, setAgentsFor] = useState<DeviceRow | undefined>(undefined);
  const liveActivities = useLiveActivitiesEnabled();
  const liveActivityShowHost = useLiveActivityShowHost();
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
  const orgId = status.state === 'signedIn' ? status.orgId : undefined;

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

  const deviceSubtitle = (d: DeviceRow): string => {
    const at = presence[d.id];
    const online = at !== undefined && Date.now() - at < 45_000;
    const bits = [
      d.platform,
      d.version !== undefined ? `v${d.version}` : undefined,
      online ? t('settings.online') : t('settings.offline'),
      `${d.capabilities.length} ${t('settings.capabilities')}`,
    ];
    return bits.filter(Boolean).join(' · ');
  };

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      {/* Native sheet chrome: centered title + text Done button (a glass
          close circle inside a system sheet is glass-on-glass). */}
      <View style={styles.header}>
        <View style={styles.headerSide} />
        <Text style={[styles.title, { color: theme.text }]}>
          {agentsFor === undefined ? t('settings.title') : t('settings.agents')}
        </Text>
        <Pressable
          onPress={onClose}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t('common.done')}
          style={styles.headerSide}
        >
          <Text style={[styles.done, { color: theme.accent }]}>
            {t('common.done')}
          </Text>
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="automatic"
      >
        {agentsFor !== undefined ? (
          <AgentsPage
            device={agentsFor}
            onBack={() => setAgentsFor(undefined)}
          />
        ) : (
          <>
            <Text style={[styles.section, { color: theme.textSecondary }]}>
              {t('settings.account')}
            </Text>
            <View
              style={[
                styles.card,
                {
                  backgroundColor: theme.cardBackground,
                  borderColor: theme.border,
                },
              ]}
            >
              <Icon
                name="person.crop.circle"
                size={22}
                color={theme.textSecondary}
              />
              <View style={styles.cardText}>
                <Text style={[styles.cardTitle, { color: theme.text }]}>
                  {demoActive
                    ? t('settings.demoAccount')
                    : user?.email ?? user?.id ?? ''}
                </Text>
                {orgId !== undefined ? (
                  <Text
                    style={[styles.cardSub, { color: theme.textSecondary }]}
                  >
                    {`${t('settings.organization')}: ${orgId}`}
                  </Text>
                ) : null}
                <Text style={[styles.cardSub, { color: theme.textSecondary }]}>
                  {`${t('settings.edgeUrl')}: ${edgeUrl}`}
                </Text>
              </View>
            </View>
            <Pressable onPress={confirmSignOut} hitSlop={8}>
              <View
                style={[
                  styles.signOut,
                  { backgroundColor: theme.cardBackground },
                ]}
              >
                <Text style={[styles.signOutText, { color: theme.danger }]}>
                  {demoActive ? t('settings.exitDemo') : t('settings.signOut')}
                </Text>
              </View>
            </Pressable>

            <Text style={[styles.section, { color: theme.textSecondary }]}>
              {t('settings.devices')}
            </Text>
            {devices.map(d => (
              <Pressable key={d.id} onPress={() => setAgentsFor(d)} hitSlop={6}>
                <View
                  style={[
                    styles.deviceRow,
                    {
                      backgroundColor: theme.cardBackground,
                      borderColor: theme.border,
                    },
                  ]}
                >
                  <Icon
                    name="externaldrive"
                    size={18}
                    color={theme.textSecondary}
                  />
                  <View style={styles.cardText}>
                    <Text style={[styles.cardTitle, { color: theme.text }]}>
                      {d.name}
                    </Text>
                    <Text
                      style={[styles.cardSub, { color: theme.textSecondary }]}
                    >
                      {deviceSubtitle(d)}
                    </Text>
                  </View>
                  <Icon
                    name="chevron.right"
                    size={13}
                    color={theme.textSecondary}
                  />
                </View>
              </Pressable>
            ))}

            <Text style={[styles.section, { color: theme.textSecondary }]}>
              {t('settings.liveActivities')}
            </Text>
            <View
              style={[
                styles.deviceRow,
                {
                  backgroundColor: theme.cardBackground,
                  borderColor: theme.border,
                },
              ]}
            >
              <View style={styles.cardText}>
                <Text style={[styles.cardTitle, { color: theme.text }]}>
                  {t('settings.liveActivitiesEnabled')}
                </Text>
              </View>
              <Switch
                value={liveActivities}
                onValueChange={setLiveActivitiesEnabled}
              />
            </View>
            <View
              style={[
                styles.deviceRow,
                {
                  backgroundColor: theme.cardBackground,
                  borderColor: theme.border,
                },
              ]}
            >
              <View style={styles.cardText}>
                <Text style={[styles.cardTitle, { color: theme.text }]}>
                  {t('settings.liveActivityShowHost')}
                </Text>
              </View>
              <Switch
                value={liveActivityShowHost}
                onValueChange={setLiveActivityShowHost}
              />
            </View>

            <Text style={[styles.section, { color: theme.textSecondary }]}>
              {t('settings.syncMode')}
            </Text>
            <View
              style={[
                styles.deviceRow,
                {
                  backgroundColor: theme.cardBackground,
                  borderColor: theme.border,
                },
              ]}
            >
              <View style={styles.cardText}>
                <Text style={[styles.cardTitle, { color: theme.text }]}>
                  {t('settings.syncModeRelay')}
                </Text>
                <Text style={[styles.cardSub, { color: theme.textSecondary }]}>
                  {t('settings.syncModeHint')}
                </Text>
              </View>
              <Switch
                value={forceRelayMode}
                onValueChange={setForceRelayMode}
                accessibilityLabel={t('settings.syncModeRelay')}
              />
            </View>

            <Text style={[styles.section, { color: theme.textSecondary }]}>
              {t('settings.dictation')}
            </Text>
            <View
              style={[
                styles.deviceRow,
                {
                  backgroundColor: theme.cardBackground,
                  borderColor: theme.border,
                },
              ]}
            >
              <View style={styles.cardText}>
                <Text style={[styles.cardTitle, { color: theme.text }]}>
                  {`${t('settings.dictationLanguage')}: ${dictationLocale}`}
                </Text>
                <Text style={[styles.cardSub, { color: theme.textSecondary }]}>
                  {dictationModelState === undefined
                    ? t('settings.dictationUnavailable')
                    : dictationStateLabel(dictationModelState)}
                </Text>
              </View>
              {dictationModelState === 'downloadable' ? (
                <Pressable
                  onPress={downloadDictationModel}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={t('settings.dictationDownload')}
                >
                  <Icon
                    name="arrow.down.circle"
                    size={20}
                    color={theme.accent}
                  />
                </Pressable>
              ) : null}
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  headerSide: {
    minWidth: 60,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'flex-end',
  },
  done: { fontSize: 17, fontWeight: '600' },
  title: { fontSize: 17, fontWeight: '600' },
  content: { padding: 16, gap: 10 },
  page: { gap: 8 },
  backRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 8,
  },
  back: { fontSize: 15 },
  section: {
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    marginTop: 10,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
  },
  cardText: { flex: 1, gap: 2 },
  cardTitle: { fontSize: 16, fontWeight: '500' },
  cardSub: { fontSize: 12 },
  signOut: {
    borderRadius: 14,
    paddingVertical: 13,
    alignItems: 'center',
    overflow: 'hidden',
  },
  signOutText: { fontSize: 16, fontWeight: '600' },
  deviceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
  },
  agentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
  },
  agentText: { flex: 1 },
  agentName: { fontSize: 15, fontWeight: '500' },
  agentSub: { fontSize: 12 },
  agentRowBtn: { minHeight: 44, justifyContent: 'center' },
  titleInput: {
    fontSize: 13,
    fontFamily: 'monospace',
    paddingVertical: 4,
  },
  error: { fontSize: 13 },
});
