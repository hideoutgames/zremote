// More-models sheet: Cursor Mobile-style list (search, Active / More) with
// sandbox and auto-approve kept as a quieter footer. Effort / Fast stay on
// the composer.

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
import { revalidateSelection } from './modelPicker';
import * as DropdownMenu from './menus/dropdown-menu';
import { MenuDismissShield } from './menus/MenuDismissShield';

export interface ModelPickerSheetProps {
  runtime: AppRuntime;
  chat: Chat;
  phase: RunPhase;
  onClose: () => void;
  formSheet?: boolean;
  /** Compose: list every provider. Session: lock to the chat harness. */
  lockHarness?: boolean;
  /** Compose: persist picker changes without writing a chat row. */
  onApplyConfig?: (config: ChatConfig) => void;
}

const SANDBOX_LEVELS = [
  'read-only',
  'workspace-write',
  'danger-full-access',
] as const;

const CLOSE = 32;

function ModelRow({
  label,
  selected,
  unavailable,
  description,
  onSelect,
  last,
  borderColor,
  textColor,
  secondaryColor,
  dangerColor,
  accentColor,
}: {
  label: string;
  selected: boolean;
  unavailable?: boolean;
  description?: string;
  onSelect: () => void;
  last: boolean;
  borderColor: string;
  textColor: string;
  secondaryColor: string;
  dangerColor: string;
  accentColor: string;
}) {
  return (
    <View
      style={[
        styles.row,
        last
          ? undefined
          : {
              borderBottomColor: borderColor,
              borderBottomWidth: StyleSheet.hairlineWidth,
            },
      ]}
    >
      <Pressable
        style={styles.rowHit}
        onPress={onSelect}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ selected }}
      >
        <Text style={[styles.rowText, { color: textColor }]} numberOfLines={1}>
          {label}
        </Text>
      </Pressable>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger>
          <Pressable
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={`${label} ${t('session.overflow')}`}
            style={styles.ellipsisHit}
          >
            <Icon name="ellipsis" size={16} color={secondaryColor} />
          </Pressable>
        </DropdownMenu.Trigger>
        <DropdownMenu.Content>
          {description !== undefined && description !== '' ? (
            <DropdownMenu.Item key="about" onSelect={() => {}}>
              <DropdownMenu.ItemTitle>{description}</DropdownMenu.ItemTitle>
            </DropdownMenu.Item>
          ) : null}
          <DropdownMenu.Item key="select" onSelect={onSelect}>
            <DropdownMenu.ItemTitle>{label}</DropdownMenu.ItemTitle>
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Root>
      {unavailable ? (
        <Text style={[styles.badge, { color: dangerColor }]}>
          {t('picker.unavailable')}
        </Text>
      ) : selected ? (
        <Icon name="checkmark" size={16} color={accentColor} />
      ) : (
        <View style={styles.checkSpacer} />
      )}
    </View>
  );
}

export function ModelPickerSheet({
  runtime,
  chat,
  phase,
  onClose,
  formSheet,
  lockHarness,
  onApplyConfig,
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

  const locked =
    (lockHarness ?? true) && harnessId !== undefined && harnessId !== '';
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
      if (onApplyConfig !== undefined) onApplyConfig(next);
      else setChatConfig(runtime, chat.id, next);
      if (next.harness !== '' && next.model !== undefined)
        rememberModelPick({ harness: next.harness, model: next.model });
    },
    [runtime, chat.id, config, onApplyConfig],
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

  const activeLabel =
    currentModels.find(m => m.id === config?.model)?.label ?? config?.model;
  const moreGroups = grouped.map(g => ({
    ...g,
    models: g.models.filter(
      m => !(m.id === config?.model && g.harness.id === harnessId),
    ),
  }));

  const header = (
    <View style={styles.header}>
      <Pressable
        onPress={onClose}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={t('common.close')}
      >
        <View style={styles.closeButton}>
          <Icon name="xmark" size={15} color={theme.text} />
        </View>
      </Pressable>
      <Text style={[styles.title, { color: theme.text }]}>
        {t('picker.title')}
      </Text>
      <View style={styles.closeButton} />
    </View>
  );

  const content = (
    <ScrollView
      contentContainerStyle={[
        styles.content,
        { paddingBottom: insets.bottom + 24 },
      ]}
      keyboardShouldPersistTaps="handled"
    >
      {live ? (
        <Text style={[styles.note, { color: theme.textSecondary }]}>
          {t('picker.appliesNext')}
        </Text>
      ) : null}

      <View
        style={[styles.searchWrap, { backgroundColor: theme.inputBackground }]}
      >
        <Icon name="magnifyingglass" size={15} color={theme.textSecondary} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={t('picker.search')}
          placeholderTextColor={theme.textSecondary}
          style={[styles.search, { color: theme.text }]}
          accessibilityLabel={t('picker.search')}
        />
      </View>

      <Text style={[styles.section, { color: theme.textSecondary }]}>
        {t('picker.active')}
      </Text>
      {config?.model !== undefined && activeLabel !== undefined ? (
        <ModelRow
          label={activeLabel}
          selected={health.modelOk}
          unavailable={!health.modelOk}
          description={
            currentModels.find(m => m.id === config.model)?.description
          }
          onSelect={() => {
            const model = currentModels.find(m => m.id === config.model);
            if (model !== undefined && harnessId !== undefined)
              pickModel(harnessId, model);
          }}
          last
          borderColor={theme.border}
          textColor={theme.text}
          secondaryColor={theme.textSecondary}
          dangerColor={theme.danger}
          accentColor={theme.accent}
        />
      ) : null}

      <Text style={[styles.section, { color: theme.textSecondary }]}>
        {t('picker.more')}
      </Text>
      {moreGroups.map(({ harness: h, models }) => (
        <View key={h.id}>
          <Text
            style={[styles.groupHead, { color: theme.textSecondary }]}
            accessibilityRole="header"
            accessibilityLabel={h.name}
          >
            {h.name}
          </Text>
          {models.map((m, i) => (
            <ModelRow
              key={m.id}
              label={m.label}
              selected={m.id === config?.model && h.id === harnessId}
              description={m.description}
              onSelect={() => pickModel(h.id, m)}
              last={i === models.length - 1}
              borderColor={theme.border}
              textColor={theme.text}
              secondaryColor={theme.textSecondary}
              dangerColor={theme.danger}
              accentColor={theme.accent}
            />
          ))}
        </View>
      ))}

      <Text style={[styles.section, { color: theme.textSecondary }]}>
        {t('picker.sandbox')}
      </Text>
      <View style={[styles.footerBlock, { borderTopColor: theme.border }]}>
        {SANDBOX_LEVELS.map(l => {
          const selected = (config?.sandbox ?? 'workspace-write') === l;
          return (
            <Pressable
              key={l}
              style={[styles.plainRow, { borderBottomColor: theme.border }]}
              onPress={() => pickSandbox(l)}
              accessibilityRole="button"
              accessibilityLabel={t(`picker.sandbox.${l}`)}
              accessibilityState={{ selected }}
            >
              <Text style={[styles.rowText, { color: theme.text }]}>
                {t(`picker.sandbox.${l}`)}
              </Text>
              {selected ? (
                <Icon name="checkmark" size={16} color={theme.accent} />
              ) : null}
            </Pressable>
          );
        })}
        <Pressable
          style={styles.plainRow}
          onPress={toggleAutoApprove}
          accessibilityRole="switch"
          accessibilityState={{ checked: autoApprove }}
          accessibilityLabel={t('picker.autoApprove')}
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
      </View>
    </ScrollView>
  );

  const body = (
    <View style={[styles.sheetBody, { backgroundColor: theme.background }]}>
      {header}
      {content}
      <MenuDismissShield />
    </View>
  );

  if (formSheet === true) {
    return (
      <Modal
        visible
        presentationStyle="formSheet"
        animationType="fade"
        allowSwipeDismissal
        onRequestClose={onClose}
      >
        <View style={[styles.modalFill, { backgroundColor: theme.background }]}>
          {body}
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
      {body}
    </TrueSheet>
  );
}

const styles = StyleSheet.create({
  modalFill: { flex: 1 },
  sheetBody: { flexGrow: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 8,
  },
  closeButton: {
    width: CLOSE,
    height: CLOSE,
    borderRadius: CLOSE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontSize: 17, fontWeight: '600' },
  content: { paddingHorizontal: 8, paddingBottom: 24, gap: 4 },
  section: {
    fontSize: 13,
    fontWeight: '600',
    marginTop: 16,
    marginBottom: 4,
    paddingHorizontal: 12,
  },
  note: { fontSize: 12, paddingHorizontal: 12, marginBottom: 4 },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 12,
    marginTop: 4,
    borderRadius: 12,
    paddingHorizontal: 12,
    gap: 8,
  },
  search: {
    flex: 1,
    paddingVertical: 10,
    fontSize: 16,
  },
  groupHead: {
    fontSize: 12,
    fontWeight: '600',
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 48,
    paddingHorizontal: 12,
    gap: 8,
  },
  rowHit: { flex: 1, minWidth: 0, justifyContent: 'center' },
  ellipsisHit: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: { fontSize: 17, flexShrink: 1 },
  rowSub: { fontSize: 13 },
  badge: { fontSize: 11, fontWeight: '600' },
  checkSpacer: { width: 16 },
  footerBlock: {
    marginTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  plainRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 48,
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
});
