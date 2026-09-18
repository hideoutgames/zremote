// NewSessionSheet (TrueSheet): space (grouped by device) or projectless host
// pick, agent + model + effort from the host catalog, and checkout choice —
// port of NewSessionView.swift's CheckoutKind rules: a ref with a worktreePath
// is "Current worktree" (local); a NEW worktree is carried to the first run as
// a WorktreeSpec on the draft (gated on host ≥ MIN_VERSION_RUN_WORKTREE).

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TrueSheet } from '@lodev09/react-native-true-sheet';
import { useStore } from 'zustand';
import { workspaceStore } from '../zeron/state/workspaceStore';
import {
  catalogStore,
  selectableHarnesses,
  modelsFor,
  reasoningLevelsFor,
} from '../zeron/state/catalogStore';
import { loadCatalog, loadModels, listRefs } from '../zeron/runtime/catalog';
import {
  createChat,
  createProjectlessChat,
} from '../zeron/runtime/workspaceActions';
import { setDraftPendingWorktree } from '../zeron/state/draftStore';
import {
  deviceVersionAtLeast,
  MIN_VERSION_RUN_WORKTREE,
} from '../zeron/protocol/entities';
import type {
  DeviceRow,
  HarnessDescriptor,
  Model,
  RepoRef,
  Space,
  WorktreeSpec,
} from '../zeron/protocol/types';
import { useRuntime } from '../app/runtimeContext';
import { Icon } from '../components/Icon';
import { EffortSlider } from '../components/EffortSlider';
import { ProviderMark } from '../components/ProviderMark';
import { providerKind, shortModelLabel } from '../components/modelLabel';
import { useTheme } from '../theme';
import { t } from '../i18n/strings';
import { createLog } from '../zeron/log';

const log = createLog();

type CheckoutKind = 'local' | 'newWorktree';

interface Selection {
  /** undefined = "Session without a project". */
  space?: Space;
  device?: DeviceRow;
  harness?: string;
  model?: string;
  reasoning?: string;
  ref?: string;
  checkout: CheckoutKind;
}

const Row = ({
  label,
  value,
  onPress,
  right,
}: {
  label: string;
  value?: string;
  onPress?: () => void;
  right?: React.ReactNode;
}) => {
  const theme = useTheme();
  return (
    <Pressable
      style={styles.row}
      onPress={onPress}
      disabled={onPress === undefined}
    >
      <Text style={[styles.rowLabel, { color: theme.textSecondary }]}>
        {label}
      </Text>
      <View style={styles.rowValue}>
        {value !== undefined ? (
          <Text
            style={[styles.rowText, { color: theme.text }]}
            numberOfLines={1}
          >
            {value}
          </Text>
        ) : null}
        {right}
      </View>
    </Pressable>
  );
};

export function NewSessionSheet({
  onClose,
  onCreated,
  initialSpaceId,
}: {
  onClose: () => void;
  onCreated: (chatId: string) => void;
  /** Preselect this space ("New session in this space" from the filter). */
  initialSpaceId?: string;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const runtime = useRuntime();
  const devices = useStore(workspaceStore, s => s.devices);
  const spaces = useStore(workspaceStore, s => s.spaces);
  const presence = useStore(workspaceStore, s => s.presence);

  const [sel, setSel] = useState<Selection>(() => {
    if (initialSpaceId === undefined) return { checkout: 'local' };
    const space = workspaceStore
      .getState()
      .spaces.find(s => s.id === initialSpaceId);
    const device =
      space === undefined
        ? undefined
        : workspaceStore.getState().devices.find(d => d.id === space.deviceId);
    return space === undefined || device === undefined
      ? { checkout: 'local' }
      : { space, device, checkout: 'local' };
  });
  const [refs, setRefs] = useState<RepoRef[] | undefined>(undefined);
  const error: string | null = null;

  const online = useCallback(
    (deviceId: string) => {
      const at = presence[deviceId];
      return at !== undefined && Date.now() - at < 45_000;
    },
    [presence],
  );

  const hostDevice = sel.device;

  // Load the catalog when the host changes.
  const catalogState = useStore(catalogStore, s =>
    hostDevice === undefined ? undefined : s.byDevice[hostDevice.id],
  );
  useEffect(() => {
    if (runtime === null || hostDevice === undefined) return;
    if (catalogState === undefined)
      loadCatalog(runtime, hostDevice.id, {
        allowMockHarness: true,
      }).catch(e => log.warn(`catalog: ${e}`));
  }, [runtime, hostDevice, catalogState]);

  const harnesses =
    hostDevice === undefined ? [] : selectableHarnesses(hostDevice.id);
  const harness = harnesses.find(h => h.id === sel.harness);

  // Lazy model list for the picked harness.
  useEffect(() => {
    if (runtime === null || hostDevice === undefined || harness === undefined)
      return;
    if (catalogState?.modelsByHarness[harness.id] === undefined)
      loadModels(runtime, hostDevice.id, harness.id).catch(() => {});
  }, [runtime, hostDevice, harness, catalogState]);
  const models =
    hostDevice !== undefined && harness !== undefined
      ? modelsFor(hostDevice.id, harness.id)
      : [];
  const model: Model | undefined = models.find(m => m.id === sel.model);
  const effortLevels =
    hostDevice !== undefined && harness !== undefined
      ? reasoningLevelsFor(hostDevice.id, harness.id, sel.model)
      : [];

  // Refs for the picked space.
  useEffect(() => {
    if (runtime === null || sel.space === undefined || hostDevice === undefined)
      return;
    let live = true;
    listRefs(runtime, hostDevice.id, sel.space.path)
      .then(r => {
        if (live) setRefs(r ?? []);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [runtime, sel.space, hostDevice]);

  const selectedRefRow = refs?.find(r => r.name === sel.ref);
  const worktreeSupported =
    hostDevice === undefined
      ? false
      : deviceVersionAtLeast(hostDevice, MIN_VERSION_RUN_WORKTREE);
  const worktreeBlocked = sel.checkout === 'newWorktree' && !worktreeSupported;

  const canCreate =
    runtime !== null &&
    hostDevice !== undefined &&
    harness !== undefined &&
    !worktreeBlocked;

  const create = useCallback(() => {
    if (runtime === null || hostDevice === undefined || harness === undefined)
      return;
    const config = {
      harness: harness.id,
      model: sel.model,
      reasoning: sel.reasoning,
      modelOptions: {},
      sandbox: undefined,
    };
    let chatId: string;
    if (sel.space !== undefined) {
      const branch =
        sel.checkout === 'local' ? selectedRefRow?.name : undefined;
      chatId = createChat(runtime, {
        deviceId: hostDevice.id,
        spaceId: sel.space.id,
        cwd: sel.space.path,
        config,
        branch,
      });
      if (sel.checkout === 'newWorktree' && sel.ref !== undefined) {
        const spec: WorktreeSpec = { repoPath: sel.space.path, base: sel.ref };
        setDraftPendingWorktree(chatId, spec);
      }
    } else {
      chatId = createProjectlessChat(runtime, hostDevice.id, config);
    }
    onCreated(chatId);
  }, [runtime, hostDevice, harness, sel, selectedRefRow, onCreated]);

  const pickSpace = (space: Space, device: DeviceRow) =>
    setSel({ space, device, checkout: 'local' });
  const pickHostless = (device: DeviceRow) =>
    setSel({ device, checkout: 'local' });

  return (
    <TrueSheet
      detents={['auto', 1]}
      initialDetentIndex={0}
      onDidDismiss={onClose}
      grabber
      backgroundColor={theme.background}
    >
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + 24 },
        ]}
      >
        <Text style={[styles.title, { color: theme.text }]}>
          {t('newSession.title')}
        </Text>

        {/* Project picker — spaces grouped by device, offline hosts labelled. */}
        <Text style={[styles.section, { color: theme.textSecondary }]}>
          {t('newSession.space')}
        </Text>
        {devices.map(device => {
          const deviceSpaces = spaces.filter(s => s.deviceId === device.id);
          if (deviceSpaces.length === 0) return null;
          return (
            <View key={device.id}>
              <Text style={[styles.deviceName, { color: theme.textSecondary }]}>
                {`${device.name}${
                  online(device.id) ? '' : ` · ${t('newSession.offline')}`
                }`}
              </Text>
              {deviceSpaces.map(s => (
                <Pressable
                  key={s.id}
                  style={[
                    styles.pick,
                    { borderColor: theme.border },
                    sel.space?.id === s.id && { borderColor: theme.accent },
                  ]}
                  onPress={() => pickSpace(s, device)}
                >
                  <Icon name="folder" size={15} color={theme.textSecondary} />
                  <Text
                    style={[styles.pickText, { color: theme.text }]}
                    numberOfLines={1}
                  >
                    {s.name ?? s.path}
                  </Text>
                </Pressable>
              ))}
            </View>
          );
        })}
        <Text style={[styles.section, { color: theme.textSecondary }]}>
          {t('newSession.noProject')}
        </Text>
        <View style={styles.hostRow}>
          {devices.map(device => (
            <Pressable
              key={device.id}
              style={[
                styles.pick,
                { borderColor: theme.border },
                sel.space === undefined &&
                  sel.device?.id === device.id && { borderColor: theme.accent },
              ]}
              onPress={() => pickHostless(device)}
            >
              <Text style={[styles.pickText, { color: theme.text }]}>
                {`${device.name}${
                  online(device.id) ? '' : ` · ${t('newSession.offline')}`
                }`}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* Agent picker. */}
        <Row
          label={t('newSession.agent')}
          value={harness?.name}
          right={
            catalogState?.loading === true ? (
              <ActivityIndicator size={14} color={theme.textSecondary} />
            ) : undefined
          }
        />
        {hostDevice !== undefined && !catalogState?.loading ? (
          harnesses.length === 0 ? (
            <Text style={[styles.hint, { color: theme.textSecondary }]}>
              {catalogState?.error ?? t('newSession.agent.none')}
            </Text>
          ) : (
            <View style={styles.chips}>
              {harnesses.map((h: HarnessDescriptor) => (
                <Pressable
                  key={h.id}
                  style={[
                    styles.chip,
                    { borderColor: theme.border },
                    sel.harness === h.id && {
                      borderColor: theme.accent,
                      backgroundColor: theme.accent + '22',
                    },
                  ]}
                  onPress={() =>
                    setSel(s => ({
                      ...s,
                      harness: h.id,
                      model: undefined,
                      reasoning: undefined,
                    }))
                  }
                >
                  <Text style={[styles.chipText, { color: theme.text }]}>
                    {h.name}
                  </Text>
                </Pressable>
              ))}
            </View>
          )
        ) : null}

        {/* Model + effort. */}
        {models.length > 0 ? (
          <>
            <Row label={t('newSession.model')} value={model?.label} />
            <View style={styles.chips}>
              {models.map(m => (
                <Pressable
                  key={m.id}
                  style={[
                    styles.chip,
                    { borderColor: theme.border },
                    sel.model === m.id && {
                      borderColor: theme.accent,
                      backgroundColor: theme.accent + '22',
                    },
                  ]}
                  onPress={() =>
                    setSel(s => ({ ...s, model: m.id, reasoning: undefined }))
                  }
                >
                  <View style={styles.chipInner}>
                    <ProviderMark
                      kind={providerKind(harness?.id, m.id)}
                      size={14}
                    />
                    <Text style={[styles.chipText, { color: theme.text }]}>
                      {shortModelLabel(m.label, m.id)}
                    </Text>
                  </View>
                </Pressable>
              ))}
            </View>
          </>
        ) : null}
        {effortLevels.length > 0 ? (
          <>
            <Row
              label={t('newSession.effort')}
              value={sel.reasoning ?? effortLevels[0]}
            />
            <EffortSlider
              levels={effortLevels}
              value={sel.reasoning}
              onChange={level => setSel(s => ({ ...s, reasoning: level }))}
            />
          </>
        ) : null}

        {/* Checkout — only for spaced sessions with refs loaded. */}
        {sel.space !== undefined && refs !== undefined && refs.length > 0 ? (
          <>
            <Row
              label={t('newSession.checkout')}
              value={
                sel.checkout === 'newWorktree'
                  ? t('newSession.checkout.newWorktree')
                  : selectedRefRow?.worktreePath !== undefined
                  ? t('newSession.checkout.currentWorktree')
                  : t('newSession.checkout.current')
              }
            />
            <View style={styles.chips}>
              {refs.map(r => (
                <Pressable
                  key={r.name}
                  style={[
                    styles.chip,
                    { borderColor: theme.border },
                    sel.ref === r.name && {
                      borderColor: theme.accent,
                      backgroundColor: theme.accent + '22',
                    },
                  ]}
                  onPress={() =>
                    setSel(s => {
                      // pickRef: a worktree'd ref flips to local; a plain
                      // non-current ref in local mode would CHECK OUT the
                      // space — here we only mark it; the switch happens via
                      // the host.
                      const next: Selection = { ...s, ref: r.name };
                      if (r.worktreePath !== undefined) next.checkout = 'local';
                      return next;
                    })
                  }
                >
                  <Text style={[styles.chipText, { color: theme.text }]}>
                    {`${r.name}${r.current ? ' ●' : ''}`}
                  </Text>
                </Pressable>
              ))}
              {sel.ref !== undefined ? (
                <Pressable
                  style={[
                    styles.chip,
                    { borderColor: theme.border },
                    sel.checkout === 'newWorktree' && {
                      borderColor: theme.accent,
                      backgroundColor: theme.accent + '22',
                    },
                  ]}
                  onPress={() =>
                    setSel(s => ({ ...s, checkout: 'newWorktree' }))
                  }
                >
                  <Text style={[styles.chipText, { color: theme.text }]}>
                    {`${t('newSession.checkout.newWorktree')} ${t(
                      'newSession.checkout.from',
                    )} ${sel.ref}`}
                  </Text>
                </Pressable>
              ) : null}
            </View>
            {worktreeBlocked ? (
              <Text style={[styles.error, { color: theme.danger }]}>
                {t('newSession.worktreeUnsupported')}
              </Text>
            ) : null}
          </>
        ) : null}

        {error !== null ? (
          <Text style={[styles.error, { color: theme.danger }]}>{error}</Text>
        ) : null}

        <Pressable onPress={create} disabled={!canCreate} hitSlop={8}>
          <View
            style={[
              styles.create,
              { backgroundColor: theme.cardBackground },
              !canCreate && styles.createDisabled,
            ]}
          >
            <Text style={[styles.createText, { color: theme.sendActive }]}>
              {hostDevice === undefined
                ? t('newSession.pickHost')
                : t('newSession.create')}
            </Text>
          </View>
        </Pressable>
      </ScrollView>
    </TrueSheet>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, gap: 8 },
  title: { fontSize: 20, fontWeight: '700', marginBottom: 8 },
  section: {
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    marginTop: 8,
  },
  deviceName: { fontSize: 12, marginBottom: 4 },
  pick: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    marginBottom: 6,
  },
  pickText: { fontSize: 14 },
  hostRow: { gap: 6 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  rowLabel: { fontSize: 14 },
  rowValue: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowText: { fontSize: 14, fontWeight: '500' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chipInner: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  chip: {
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  chipText: { fontSize: 13 },
  hint: { fontSize: 13 },
  error: { fontSize: 13 },
  create: {
    borderRadius: 22,
    paddingVertical: 13,
    alignItems: 'center',
    marginTop: 12,
    overflow: 'hidden',
  },
  createDisabled: { opacity: 0.5 },
  createText: { fontSize: 16, fontWeight: '600' },
});
