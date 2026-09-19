// More-models sheet: search + models for the session's provider. Effort /
// Fast live on the composer overlay. Sandbox and auto-approve stay here.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { TrueSheet } from '@lodev09/react-native-true-sheet';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useStore } from 'zustand';
import type { AppRuntime } from '../zeron/runtime/appRuntime';
import type { Chat, ChatConfig, Model } from '../zeron/protocol/types';
import {
  catalogStore,
  modelsFor,
  selectableHarnesses,
} from '../zeron/state/catalogStore';
import { loadModels } from '../zeron/runtime/catalog';
import { setChatConfig } from '../zeron/runtime/workspaceActions';
import {
  rememberModelPick,
  setAutoApprove,
  useAutoApprove,
} from '../zeron/state/uiPrefs';
import type { RunPhase } from '../zeron/state/sessionStores';
import { useTheme } from '../theme';
import { t } from '../i18n/strings';
import { Icon } from './Icon';
import { HarnessMark } from './HarnessMark';
import { revalidateSelection } from './modelPicker';

export interface ModelPickerSheetProps {
  runtime: AppRuntime;
  chat: Chat;
  phase: RunPhase;
  onClose: () => void;
  formSheet?: boolean;
}

const SANDBOX_LEVELS = [
  'read-only',
  'workspace-write',
  'danger-full-access',
] as const;

export function ModelPickerSheet({
  runtime,
  chat,
  phase,
  onClose,
  formSheet,
}: ModelPickerSheetProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const deviceId = chat.deviceId;
  const catalog = useStore(catalogStore, s => s.byDevice[deviceId]);
  const catalogTick = catalog?.loadedAt ?? 0;
  const [query, setQuery] = useState('');

  const harnesses = useMemo(
    () => selectableHarnesses(deviceId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [deviceId, catalogTick],
  );
  const config = chat.config;
  const harnessId = config?.harness;

  useEffect(() => {
    for (const h of harnesses) {
      if (modelsFor(deviceId, h.id).length === 0)
        loadModels(runtime, deviceId, h.id).catch(() => {});
    }
  }, [harnesses, runtime, deviceId, catalogTick]);

  const locked = harnessId !== undefined && harnessId !== '';
  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    return harnesses
      .filter(h => !locked || h.id === harnessId)
      .map(h => ({
        harness: h,
        models: modelsFor(deviceId, h.id).filter(m => {
          if (q === '') return true;
          return (
            m.label.toLowerCase().includes(q) ||
            m.id.toLowerCase().includes(q) ||
            h.name.toLowerCase().includes(q)
          );
        }),
      }))
      .filter(g => g.models.length > 0 || q === '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [harnesses, deviceId, catalogTick, query, locked, harnessId]);

  const currentModels = useMemo(
    () => (harnessId === undefined ? [] : modelsFor(deviceId, harnessId)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [deviceId, harnessId, catalogTick],
  );
  const health = revalidateSelection(config, {
    selectableHarnessIds: harnesses.map(h => h.id),
    models: currentModels,
    reasoningLevels: [],
  });

  const live = phase === 'working' || phase === 'stopping';
  const autoApprove = useAutoApprove(chat.id);
  const toggleAutoApprove = useCallback(() => {
    if (autoApprove) {
      setAutoApprove(chat.id, false);
      return;
    }
    Alert.alert(t('picker.autoApproveConfirm'), undefined, [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.enable'),
        style: 'destructive',
        onPress: () => setAutoApprove(chat.id, true),
      },
    ]);
  }, [autoApprove, chat.id]);

  const apply = useCallback(
    (patch: Partial<ChatConfig>) => {
      const next: ChatConfig = {
        harness: config?.harness ?? '',
        modelOptions: config?.modelOptions ?? {},
        ...config,
        ...patch,
      };
      setChatConfig(runtime, chat.id, next);
      if (next.harness !== '' && next.model !== undefined)
        rememberModelPick({ harness: next.harness, model: next.model });
    },
    [runtime, chat.id, config],
  );

  const pickModel = useCallback(
    (harness: string, model: Model) => {
      if (locked && harness !== harnessId) return;
      if (harness !== harnessId) {
        apply({
          harness,
          model: model.id,
          reasoning: undefined,
        });
        return;
      }
      apply({ model: model.id });
    },
    [apply, locked, harnessId],
  );

  const pickSandbox = useCallback(
    (level: string) => {
      if (level === 'danger-full-access') {
        Alert.alert(t('picker.dangerConfirm'), undefined, [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('common.enable'),
            style: 'destructive',
            onPress: () => apply({ sandbox: level }),
          },
        ]);
        return;
      }
      apply({ sandbox: level });
    },
    [apply],
  );

  const content = (
    <ScrollView
      contentContainerStyle={[
        styles.content,
        { paddingBottom: insets.bottom + 24 },
      ]}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={[styles.title, { color: theme.text }]}>
        {t('picker.title')}
      </Text>
      {live ? (
        <Text style={[styles.note, { color: theme.textSecondary }]}>
          {t('picker.appliesNext')}
        </Text>
      ) : null}

      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder={t('picker.search')}
        placeholderTextColor={theme.textSecondary}
        style={[
          styles.search,
          { color: theme.text, backgroundColor: theme.inputBackground },
        ]}
        accessibilityLabel={t('picker.search')}
      />

      <Text style={[styles.section, { color: theme.textSecondary }]}>
        {t('picker.active')}
      </Text>
      {config?.model !== undefined ? (
        <View
          style={[
            styles.row,
            { borderColor: health.modelOk ? theme.accent : theme.danger },
          ]}
        >
          <HarnessMark harnessId={harnessId} size={18} color={theme.text} />
          <Text style={[styles.rowText, { color: theme.text }]}>
            {currentModels.find(m => m.id === config.model)?.label ??
              config.model}
          </Text>
          {health.modelOk ? (
            <Icon name="checkmark" size={14} color={theme.accent} />
          ) : (
            <Text style={[styles.badge, { color: theme.danger }]}>
              {t('picker.unavailable')}
            </Text>
          )}
        </View>
      ) : null}

      {grouped.map(({ harness: h, models }) => (
        <View key={h.id} style={styles.group}>
          <View
            style={styles.groupHead}
            accessibilityRole="header"
            accessibilityLabel={h.name}
          >
            <HarnessMark harnessId={h.id} size={16} color={theme.text} />
            <Text style={[styles.section, { color: theme.textSecondary }]}>
              {h.name}
            </Text>
          </View>
          {models.map(m => (
            <Pressable
              key={m.id}
              style={[
                styles.row,
                { borderColor: theme.border },
                m.id === config?.model &&
                  h.id === harnessId && { borderColor: theme.accent },
              ]}
              onPress={() => pickModel(h.id, m)}
              accessibilityRole="button"
              accessibilityLabel={m.label}
              accessibilityState={{
                selected: m.id === config?.model && h.id === harnessId,
              }}
            >
              <View style={styles.rowBody}>
                <Text style={[styles.rowText, { color: theme.text }]}>
                  {m.label}
                </Text>
                {m.description !== undefined ? (
                  <Text
                    style={[styles.rowSub, { color: theme.textSecondary }]}
                    numberOfLines={1}
                  >
                    {m.description}
                  </Text>
                ) : null}
              </View>
              {m.id === config?.model && h.id === harnessId ? (
                <Icon name="checkmark" size={14} color={theme.accent} />
              ) : null}
            </Pressable>
          ))}
        </View>
      ))}

      <Text style={[styles.section, { color: theme.textSecondary }]}>
        {t('picker.sandbox')}
      </Text>
      <View style={styles.segmented}>
        {SANDBOX_LEVELS.map(l => {
          const selected = (config?.sandbox ?? 'workspace-write') === l;
          return (
            <Pressable
              key={l}
              style={[
                styles.segment,
                {
                  backgroundColor: selected
                    ? theme.accent
                    : theme.cardBackground,
                },
              ]}
              onPress={() => pickSandbox(l)}
              accessibilityRole="button"
              accessibilityLabel={t(`picker.sandbox.${l}`)}
              accessibilityState={{ selected }}
            >
              <Text
                style={[
                  styles.segmentTextSmall,
                  { color: selected ? theme.sendActive : theme.text },
                ]}
              >
                {t(`picker.sandbox.${l}`)}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <Pressable
        style={[styles.row, { borderColor: theme.border }]}
        onPress={toggleAutoApprove}
        accessibilityRole="switch"
        accessibilityState={{ checked: autoApprove }}
      >
        <Text style={[styles.rowText, { color: theme.text }]}>
          {t('picker.autoApprove')}
        </Text>
        <Text
          style={[
            styles.rowSub,
            { color: autoApprove ? theme.danger : theme.textSecondary },
          ]}
        >
          {autoApprove ? t('common.on') : t('common.off')}
        </Text>
      </Pressable>

      <View style={styles.footer}>
        <View
          style={[styles.doneBtn, { backgroundColor: theme.cardBackground }]}
        >
          <Pressable
            onPress={onClose}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t('common.done')}
          >
            <Text style={[styles.doneText, { color: theme.accent }]}>
              {t('common.done')}
            </Text>
          </Pressable>
        </View>
      </View>
    </ScrollView>
  );

  if (formSheet === true) {
    return (
      <Modal
        visible
        presentationStyle="formSheet"
        animationType="fade"
        onRequestClose={onClose}
      >
        <View style={[styles.modalFill, { backgroundColor: theme.background }]}>
          {content}
        </View>
      </Modal>
    );
  }
  return (
    <TrueSheet
      detents={['auto', 1]}
      initialDetentIndex={0}
      onDidDismiss={onClose}
      grabber
      backgroundColor={theme.background}
    >
      {content}
    </TrueSheet>
  );
}

const styles = StyleSheet.create({
  modalFill: { flex: 1 },
  content: { padding: 20, gap: 10 },
  title: { fontSize: 20, fontWeight: '700' },
  section: { fontSize: 12, fontWeight: '600', marginTop: 10 },
  note: { fontSize: 12 },
  search: {
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  group: { gap: 8 },
  groupHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 12,
    gap: 8,
  },
  rowBody: { flex: 1, gap: 2 },
  rowText: { fontSize: 15, flex: 1 },
  rowSub: { fontSize: 12 },
  badge: { fontSize: 11, fontWeight: '600' },
  segmented: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  segment: {
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  segmentTextSmall: { fontSize: 12 },
  footer: { marginTop: 16, alignItems: 'center' },
  doneBtn: {
    borderRadius: 22,
    paddingHorizontal: 28,
    paddingVertical: 10,
    overflow: 'hidden',
  },
  doneText: { fontSize: 15, fontWeight: '600' },
});
