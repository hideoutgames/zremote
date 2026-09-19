// Full-model sheet: providers in catalog order, checkmark on the current
// model, composer effort chip + Fast control inline. No Active/More split,
// no sandbox/auto-approve footer.

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { EffortOrigin } from './EffortOverlay';
import {
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
import {
  FULL_ACCESS_SANDBOX,
  type Chat,
  type ChatConfig,
  type Model,
} from '../zeron/protocol/types';
import {
  catalogStore,
  modelsFor,
  selectableHarnesses,
} from '../zeron/state/catalogStore';
import { loadModels } from '../zeron/runtime/catalog';
import { setChatConfig } from '../zeron/runtime/workspaceActions';
import {
  rememberModelPick,
  rememberModelSettings,
  useModelSettingsMap,
} from '../zeron/state/uiPrefs';
import {
  effortLevelsForModel,
  modelRowKey,
  rememberedModelOptions,
  rememberedReasoning,
  revalidateSelection,
} from './modelPicker';
import type { RunPhase } from '../zeron/state/sessionStores';
import { useTheme } from '../theme';
import { t } from '../i18n/strings';
import { Icon } from './Icon';
import { FastMenuButton } from './FastMenuButton';
import { ComposerMenuChip } from './ComposerMenuChip';
import { EffortOverlay } from './EffortOverlay';
import { capitalizeLevel } from './effortSliderMath';
import { fastOptionForModel, isFastEnabled } from './fastMode';
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

const CLOSE = 32;

function ModelRow({
  label,
  selected,
  unavailable,
  effortLabel,
  effortSupported,
  onSelect,
  onOpenEffort,
  fastSupported,
  fastEnabled,
  fastOption,
  fastChoice,
  onSelectFast,
  last,
  borderColor,
  textColor,
  secondaryColor,
  dangerColor,
  accentColor,
  onLayout,
}: {
  label: string;
  selected: boolean;
  unavailable?: boolean;
  effortLabel?: string;
  effortSupported: boolean;
  onSelect: () => void;
  onOpenEffort: (origin?: EffortOrigin) => void;
  fastSupported: boolean;
  fastEnabled: boolean;
  fastOption?: Parameters<typeof FastMenuButton>[0]['option'];
  fastChoice?: string;
  onSelectFast: (choiceId: string) => void;
  last: boolean;
  borderColor: string;
  textColor: string;
  secondaryColor: string;
  dangerColor: string;
  accentColor: string;
  onLayout?: (y: number) => void;
}) {
  const effortRef = useRef<View>(null);
  const openEffort = () => {
    const node = effortRef.current;
    if (node !== null && typeof node.measureInWindow === 'function') {
      node.measureInWindow((x, y, width, height) => {
        onOpenEffort({ x, y, width, height });
      });
      return;
    }
    onOpenEffort();
  };
  return (
    <View
      onLayout={e => onLayout?.(e.nativeEvent.layout.y)}
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
      <View style={styles.rowMain}>
        <Pressable
          style={styles.rowHit}
          onPress={onSelect}
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityState={{ selected }}
        >
          <Text
            style={[styles.rowText, { color: textColor }]}
            numberOfLines={1}
          >
            {label}
          </Text>
        </Pressable>
        {effortSupported && effortLabel !== undefined ? (
          <Pressable
            ref={effortRef}
            onPress={openEffort}
            hitSlop={4}
            accessibilityRole="button"
            accessibilityLabel={effortLabel}
          >
            <ComposerMenuChip
              label={effortLabel}
              color={textColor}
              chevronColor={secondaryColor}
              limitWidth={false}
            />
          </Pressable>
        ) : null}
      </View>
      <View style={styles.rowTrail}>
        {fastSupported ? (
          <FastMenuButton
            enabled={fastEnabled}
            option={fastOption}
            value={fastChoice}
            onSelect={onSelectFast}
          />
        ) : null}
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
  const modelSettings = useModelSettingsMap();
  const [effort, setEffort] = useState<{
    harness: string;
    model: string;
    levels: string[];
    origin?: EffortOrigin;
  }>();
  const scrollRef = useRef<ScrollView>(null);
  const rowY = useRef<Record<string, number>>({});
  const groupY = useRef<Record<string, number>>({});
  const scrolled = useRef(false);

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
  const selectedKey =
    harnessId !== undefined && config?.model !== undefined
      ? modelRowKey(harnessId, config.model)
      : undefined;

  const scrollToSelected = useCallback(() => {
    if (
      selectedKey === undefined ||
      harnessId === undefined ||
      scrolled.current
    )
      return;
    const y = rowY.current[selectedKey];
    const groupTop = groupY.current[harnessId];
    if (y === undefined || groupTop === undefined) return;
    scrolled.current = true;
    scrollRef.current?.scrollTo({
      y: Math.max(0, groupTop + y - 12),
      animated: false,
    });
  }, [selectedKey, harnessId]);

  const apply = useCallback(
    (patch: Partial<ChatConfig>) => {
      const next: ChatConfig = {
        harness: config?.harness ?? '',
        modelOptions: config?.modelOptions ?? {},
        ...config,
        ...patch,
        sandbox: FULL_ACCESS_SANDBOX,
      };
      if (onApplyConfig !== undefined) onApplyConfig(next);
      else setChatConfig(runtime, chat.id, next);
      if (next.harness !== '' && next.model !== undefined) {
        rememberModelPick({ harness: next.harness, model: next.model });
        rememberModelSettings(next.harness, next.model, {
          reasoning: next.reasoning,
          modelOptions: next.modelOptions,
        });
      }
    },
    [runtime, chat.id, config, onApplyConfig],
  );

  const pickModel = useCallback(
    (harness: string, model: Model, extra?: Partial<ChatConfig>) => {
      if (locked && harness !== harnessId) return;
      const levels = effortLevelsForModel(
        model,
        harnesses.find(h => h.id === harness)?.reasoningLevels,
      );
      const stored = modelSettings[modelRowKey(harness, model.id)];
      const selectedLive =
        harness === harnessId && config?.model === model.id
          ? {
              reasoning: config?.reasoning,
              modelOptions: config?.modelOptions,
            }
          : undefined;
      const fastOption = fastOptionForModel(model);
      const reasoning =
        extra?.reasoning ??
        rememberedReasoning(stored, levels, selectedLive?.reasoning);
      const modelOptions =
        extra?.modelOptions ??
        rememberedModelOptions(stored, fastOption, selectedLive?.modelOptions);
      apply({
        harness,
        model: model.id,
        reasoning,
        modelOptions,
        ...extra,
      });
    },
    [apply, locked, harnessId, harnesses, config, modelSettings],
  );

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
      ref={scrollRef}
      style={styles.scroll}
      contentContainerStyle={[
        styles.content,
        { paddingBottom: insets.bottom + 24 },
      ]}
      keyboardShouldPersistTaps="handled"
      onContentSizeChange={scrollToSelected}
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

      {grouped.map(({ harness: h, models }) => (
        <View
          key={h.id}
          onLayout={e => {
            groupY.current[h.id] = e.nativeEvent.layout.y;
            if (selectedKey?.startsWith(`${h.id}:`)) scrollToSelected();
          }}
        >
          <Text
            style={[styles.groupHead, { color: theme.textSecondary }]}
            accessibilityRole="header"
            accessibilityLabel={h.name}
          >
            {h.name}
          </Text>
          {models.map((m, i) => {
            const selected = m.id === config?.model && h.id === harnessId;
            const levels = effortLevelsForModel(m, h.reasoningLevels);
            const effortSupported = levels.length > 0;
            const stored = modelSettings[modelRowKey(h.id, m.id)];
            const effortValue = rememberedReasoning(
              stored,
              levels,
              selected ? config?.reasoning : undefined,
            );
            const fastOption = fastOptionForModel(m);
            const rowOptions = rememberedModelOptions(
              stored,
              fastOption,
              selected ? config?.modelOptions : undefined,
            );
            const key = modelRowKey(h.id, m.id);
            return (
              <ModelRow
                key={m.id}
                label={m.label}
                selected={selected}
                unavailable={selected && !health.modelOk}
                effortSupported={effortSupported}
                effortLabel={
                  effortSupported && effortValue !== undefined
                    ? capitalizeLevel(effortValue)
                    : undefined
                }
                onSelect={() => pickModel(h.id, m)}
                onOpenEffort={origin => {
                  pickModel(h.id, m);
                  setEffort({
                    harness: h.id,
                    model: m.id,
                    levels,
                    origin,
                  });
                }}
                fastSupported={fastOption !== undefined}
                fastOption={fastOption}
                fastEnabled={isFastEnabled(rowOptions, fastOption)}
                fastChoice={
                  fastOption === undefined
                    ? undefined
                    : typeof rowOptions[fastOption.id] === 'string'
                    ? (rowOptions[fastOption.id] as string)
                    : fastOption.defaultChoice
                }
                onSelectFast={choiceId => {
                  if (fastOption === undefined) return;
                  pickModel(h.id, m, {
                    modelOptions: {
                      ...rowOptions,
                      [fastOption.id]: choiceId,
                    },
                  });
                }}
                last={i === models.length - 1}
                borderColor={theme.border}
                textColor={theme.text}
                secondaryColor={theme.textSecondary}
                dangerColor={theme.danger}
                accentColor={theme.accent}
                onLayout={y => {
                  rowY.current[key] = y;
                  if (key === selectedKey) scrollToSelected();
                }}
              />
            );
          })}
        </View>
      ))}
    </ScrollView>
  );

  const body = (
    <View style={[styles.sheetBody, { backgroundColor: theme.background }]}>
      {header}
      {content}
      <MenuDismissShield />
    </View>
  );

  const sheet =
    formSheet === true ? (
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
    ) : (
      <TrueSheet
        detents={['auto', 1]}
        initialDetentIndex={1}
        onDidDismiss={onClose}
        grabber
        backgroundColor={theme.background}
      >
        {body}
      </TrueSheet>
    );

  const effortLevels = effort?.levels ?? [];
  const effortValue =
    effort === undefined
      ? undefined
      : rememberedReasoning(
          modelSettings[modelRowKey(effort.harness, effort.model)],
          effortLevels,
          config?.harness === effort.harness && config.model === effort.model
            ? config.reasoning
            : undefined,
        );

  return (
    <>
      {sheet}
      {effort !== undefined ? (
        <EffortOverlay
          levels={effortLevels}
          value={effortValue}
          origin={effort.origin}
          onChange={level =>
            apply({
              harness: effort.harness,
              model: effort.model,
              reasoning: level,
            })
          }
          onDismiss={() => setEffort(undefined)}
        />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  modalFill: { flex: 1 },
  sheetBody: { flexGrow: 1, flex: 1 },
  scroll: { flex: 1 },
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
    paddingTop: 16,
    paddingBottom: 2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 48,
    paddingHorizontal: 12,
    gap: 8,
  },
  rowMain: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  rowHit: { flexShrink: 1, minWidth: 0, justifyContent: 'center' },
  rowText: { fontSize: 17, flexShrink: 1 },
  rowTrail: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 0,
    gap: 4,
    marginLeft: 'auto',
  },
  badge: { fontSize: 11, fontWeight: '600' },
  checkSpacer: { width: 16 },
});
