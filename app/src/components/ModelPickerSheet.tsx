// ModelPickerSheet (TrueSheet) — Agents / Models / Effort / Model options /
// Sandbox & approvals for the session's host device. Desktop rules:
//   - harness is LOCKED once the chat exists (crates/ui/src/pickers.rs
//     harness_locked L770-771 — `selected_chat.is_some()`); a foreign
//     harness pick also clears model+reasoning (pick_harness L1473-1480);
//   - RunRequest defaults: sandbox WorkspaceWrite, auto_approve false
//     (crates/ui/src/composer.rs send path L6522-6523);
//   - an unavailable saved model shows "Unavailable on this host" — never
//     auto-replaced.
// Applying writes the whole ChatConfig via setChatConfig (LWW); while a run
// is working/stopping selections apply to the NEXT message.

import React, { useCallback, useMemo } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { TrueSheet } from '@lodev09/react-native-true-sheet';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useStore } from 'zustand';
import type { AppRuntime } from '../zeron/runtime/appRuntime';
import type { Chat, ChatConfig } from '../zeron/protocol/types';
import {
  catalogStore,
  modelsFor,
  reasoningLevelsFor,
  selectableHarnesses,
} from '../zeron/state/catalogStore';
import { loadModels } from '../zeron/runtime/catalog';
import { setChatConfig } from '../zeron/runtime/workspaceActions';
import { setAutoApprove, useAutoApprove } from '../zeron/state/uiPrefs';
import type { RunPhase } from '../zeron/state/sessionStores';
import { useTheme } from '../theme';
import { t } from '../i18n/strings';
import { Glass } from './Glass';
import { Icon } from './Icon';
import { EffortSlider } from './EffortSlider';
import { revalidateSelection } from './modelPicker';

export interface ModelPickerSheetProps {
  runtime: AppRuntime;
  chat: Chat;
  phase: RunPhase;
  /** True while the chat already exists/messages — locks the harness row
   * (desktop: `harness_locked` = selected_chat.is_some()). */
  hasMessages: boolean;
  onClose: () => void;
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
  hasMessages,
  onClose,
}: ModelPickerSheetProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const deviceId = chat.deviceId;
  const catalog = useStore(catalogStore, s => s.byDevice[deviceId]);

  const catalogTick = catalog?.loadedAt ?? 0; // re-derive on catalog load
  const harnesses = useMemo(
    () => selectableHarnesses(deviceId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [deviceId, catalogTick],
  );
  const config = chat.config;
  const harnessId = config?.harness;
  const models = useMemo(
    () => (harnessId === undefined ? [] : modelsFor(deviceId, harnessId)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [deviceId, harnessId, catalogTick],
  );
  const levels = useMemo(
    () =>
      harnessId === undefined
        ? []
        : reasoningLevelsFor(deviceId, harnessId, config?.model),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [deviceId, harnessId, config?.model, catalogTick],
  );
  const health = revalidateSelection(config, {
    selectableHarnessIds: harnesses.map(h => h.id),
    models,
    reasoningLevels: levels,
  });

  // Load the model catalog lazily on open.
  React.useEffect(() => {
    if (catalog !== undefined && models.length === 0 && harnessId !== undefined)
      loadModels(runtime, deviceId, harnessId).catch(() => {});
  }, [catalog, models.length, runtime, deviceId, harnessId]);

  const live = phase === 'working' || phase === 'stopping';
  // RunRequest.autoApprove is a per-chat RUN field (not ChatConfig) — kept
  // in uiPrefs and applied at send time; off by default.
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
    },
    [runtime, chat.id, config],
  );

  const pickHarness = useCallback(
    (id: string) => {
      if (hasMessages) return; // harness locked mid-chat
      // Foreign harness pick: clear the remembered model+reasoning so a
      // stale pick can't linger (pick_harness).
      apply({ harness: id, model: undefined, reasoning: undefined });
    },
    [hasMessages, apply],
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
          {t('picker.title')}
        </Text>
        {live ? (
          <Text style={[styles.note, { color: theme.textSecondary }]}>
            {t('picker.appliesNext')}
          </Text>
        ) : null}

        {/* Agents — locked once the chat exists. */}
        <Text style={[styles.section, { color: theme.textSecondary }]}>
          {t('picker.agents')}
        </Text>
        {harnesses.map(h => (
          <Pressable
            key={h.id}
            style={[
              styles.row,
              { borderColor: theme.border },
              h.id === harnessId && { borderColor: theme.accent },
              hasMessages && styles.rowDimmed,
            ]}
            onPress={() => pickHarness(h.id)}
            disabled={hasMessages}
          >
            <Text style={[styles.rowText, { color: theme.text }]}>
              {h.name}
            </Text>
            {h.id === harnessId ? (
              <Icon name="checkmark" size={14} color={theme.accent} />
            ) : null}
          </Pressable>
        ))}
        {hasMessages ? (
          <Text style={[styles.note, { color: theme.textSecondary }]}>
            {t('picker.harnessLocked')}
          </Text>
        ) : null}

        {/* Models — unavailable saved selection is shown, not replaced. */}
        <Text style={[styles.section, { color: theme.textSecondary }]}>
          {t('picker.models')}
        </Text>
        {!health.modelOk && config?.model !== undefined ? (
          <View style={[styles.row, { borderColor: theme.danger }]}>
            <Text style={[styles.rowText, { color: theme.text }]}>
              {config.model}
            </Text>
            <Text style={[styles.badge, { color: theme.danger }]}>
              {t('picker.unavailable')}
            </Text>
          </View>
        ) : null}
        {models.map(m => (
          <Pressable
            key={m.id}
            style={[
              styles.row,
              { borderColor: theme.border },
              m.id === config?.model && { borderColor: theme.accent },
            ]}
            onPress={() => apply({ model: m.id })}
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
            {m.id === config?.model ? (
              <Icon name="checkmark" size={14} color={theme.accent} />
            ) : null}
          </Pressable>
        ))}

        {/* Effort — hidden with an explanation when the harness advertises
            no levels. */}
        <Text style={[styles.section, { color: theme.textSecondary }]}>
          {t('picker.effort')}
        </Text>
        {levels.length === 0 ? (
          <Text style={[styles.note, { color: theme.textSecondary }]}>
            {t('picker.effortUnsupported')}
          </Text>
        ) : (
          <EffortSlider
            levels={levels}
            value={config?.reasoning}
            onChange={level => apply({ reasoning: level })}
          />
        )}

        {/* Model options — segmented rows; untouched choices round-trip. */}
        {(models.find(m => m.id === config?.model)?.options ?? []).map(opt => (
          <View key={opt.id} style={styles.optGroup}>
            <Text style={[styles.section, { color: theme.textSecondary }]}>
              {opt.label}
            </Text>
            <View style={styles.segmented}>
              {opt.choices.map(c => {
                const selected =
                  (config?.modelOptions?.[opt.id] as string | undefined) ??
                  opt.defaultChoice;
                return (
                  <Pressable
                    key={c.id}
                    style={[
                      styles.segment,
                      {
                        backgroundColor:
                          c.id === selected
                            ? theme.accent
                            : theme.cardBackground,
                      },
                    ]}
                    onPress={() =>
                      apply({
                        modelOptions: {
                          ...(config?.modelOptions ?? {}),
                          [opt.id]: c.id,
                        },
                      })
                    }
                  >
                    <Text
                      style={[
                        styles.segmentText,
                        {
                          color:
                            c.id === selected ? theme.sendActive : theme.text,
                        },
                      ]}
                    >
                      {c.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ))}

        {/* Sandbox / approvals — consequential choices confirm. */}
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
          <Glass interactive style={styles.doneBtn}>
            <Pressable onPress={onClose} hitSlop={8}>
              <Text style={[styles.doneText, { color: theme.accent }]}>
                {t('common.done')}
              </Text>
            </Pressable>
          </Glass>
        </View>
      </ScrollView>
    </TrueSheet>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, gap: 10 },
  title: { fontSize: 20, fontWeight: '700' },
  section: { fontSize: 12, fontWeight: '600', marginTop: 10 },
  note: { fontSize: 12 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 12,
    gap: 8,
  },
  rowDimmed: { opacity: 0.4 },
  rowBody: { flex: 1, gap: 2 },
  rowText: { fontSize: 15 },
  rowSub: { fontSize: 12 },
  badge: { fontSize: 11, fontWeight: '600' },
  optGroup: { gap: 6 },
  segmented: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  segment: {
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  segmentText: { fontSize: 13 },
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
