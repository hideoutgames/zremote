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
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useStore } from 'zustand';
import { workspaceStore } from '../zeron/state/workspaceStore';
import { authStore } from '../zeron/state/authStore';
import { catalogStore } from '../zeron/state/catalogStore';
import { loadCatalog, setHarnessEnabled } from '../zeron/runtime/catalog';
import { appConfig } from '../zeron/native/appConfig';
import { useAppServices, useRuntime } from '../app/runtimeContext';
import type { DeviceRow } from '../zeron/protocol/types';
import { Glass } from '../components/Glass';
import { Icon } from '../components/Icon';
import { useTheme } from '../theme';
import { t } from '../i18n/strings';
import { createLog } from '../zeron/log';

const log = createLog();

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

  useEffect(() => {
    if (runtime !== null)
      loadCatalog(runtime, device.id, { allowMockHarness: true }).catch(e =>
        log.warn(`catalog: ${e}`),
      );
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
  const insets = useSafeAreaInsets();
  const { signOut } = useAppServices();
  const status = useStore(authStore, s => s.status);
  const devices = useStore(workspaceStore, s => s.devices);
  const presence = useStore(workspaceStore, s => s.presence);
  const edgeUrl = appConfig().edgeUrl;
  const [agentsFor, setAgentsFor] = useState<DeviceRow | undefined>(undefined);

  const user =
    status.state === 'signedIn' || status.state === 'needsOrganization'
      ? status.user
      : undefined;
  const orgId = status.state === 'signedIn' ? status.orgId : undefined;

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
    <View
      style={[
        styles.root,
        { backgroundColor: theme.background, paddingTop: insets.top + 8 },
      ]}
    >
      <View style={styles.header}>
        <Pressable onPress={onClose} hitSlop={8}>
          <Glass interactive style={styles.circle}>
            <Icon name="xmark" size={16} color={theme.text} />
          </Glass>
        </Pressable>
        <Text style={[styles.title, { color: theme.text }]}>
          {agentsFor === undefined ? t('settings.title') : t('settings.agents')}
        </Text>
        <View style={styles.circle} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
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
                  {user?.email ?? user?.id ?? ''}
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
              <Glass interactive style={styles.signOut}>
                <Text style={[styles.signOutText, { color: theme.danger }]}>
                  {t('settings.signOut')}
                </Text>
              </Glass>
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
  circle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
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
  error: { fontSize: 13 },
});
