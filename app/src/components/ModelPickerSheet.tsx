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
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
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
  togglePinnedModel,
  useModelSettingsMap,
  usePinnedModels,
} from '../zeron/state/uiPrefs';
import { pinnedMenuModels } from '../zeron/state/pinnedModels';
import {
  modelRowKey,
  rememberedModelOptions,
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
import {
  applyEffortLevel,
  applyFastChoice,
  resolveModelTraits,
  selectionForModel,
} from './modelTraits';
import { MenuDismissShield } from './menus/MenuDismissShield';
import { useDismissibleNativeModal } from '../hooks/useDismissibleNativeModal';
import { GlassControl } from './Glass';
import * as ContextMenu from './menus/context-menu';
import { HarnessMark } from './HarnessMark';

export interface ModelPickerSheetProps {
  /** Null in test mode: catalog reads still work, loads/apply are skipped. */
  runtime: AppRuntime | null;
  chat: Chat;
  phase: RunPhase;
  onClose: () => void;
  /** Regular width → formSheet; compact (iPhone) defaults to pageSheet. */
  formSheet?: boolean;
  /** Compose: list every provider. Session: lock to the chat harness. */
  lockHarness?: boolean;
  /** Compose: persist picker changes without writing a chat row. */
  onApplyConfig?: (config: ChatConfig) => void;
}

const CLOSE = 32;
/** Dark check on the orange Done glass (matches PlanSheet CTA label). */
const DONE_CHECK = '#1C1204';

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
  harnessId,
  providerName,
  pin,
}: {
  label: string;
  selected: boolean;
  unavailable?: boolean;
  effortLabel?: string;
  effortSupported: boolean;
  onSelect: () => void;
  onOpenEffort: () => void;
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
  harnessId?: string;
  providerName?: string;
  pin: {
    pinned: boolean;
    onToggle: () => void;
  };
}) {
  const suppressSelect = useRef(false);
  const suppressTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const armSuppress = useCallback(() => {
    suppressSelect.current = true;
    if (suppressTimer.current !== undefined) {
      clearTimeout(suppressTimer.current);
      suppressTimer.current = undefined;
    }
  }, []);
  const onMenuOpenChange = useCallback(
    (open: boolean) => {
      if (open) {
        armSuppress();
        return;
      }
      suppressTimer.current = setTimeout(() => {
        suppressSelect.current = false;
        suppressTimer.current = undefined;
      }, 100);
    },
    [armSuppress],
  );
  useEffect(
    () => () => {
      if (suppressTimer.current !== undefined)
        clearTimeout(suppressTimer.current);
    },
    [],
  );
  const a11yLabel =
    providerName !== undefined && providerName !== ''
      ? `${label}, ${providerName}`
      : label;
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
      <View style={styles.rowHitWrap}>
        <ContextMenu.Root onOpenChange={onMenuOpenChange}>
          <ContextMenu.Trigger>
            <Pressable
              style={styles.rowHit}
              onPress={() => {
                if (suppressSelect.current) return;
                onSelect();
              }}
              onLongPress={armSuppress}
              accessibilityRole="button"
              accessibilityLabel={a11yLabel}
              accessibilityState={{ selected }}
            >
              {harnessId !== undefined ? (
                <HarnessMark
                  harnessId={harnessId}
                  size={16}
                  color={textColor}
                />
              ) : null}
              <View style={styles.rowLabel}>
                <Text
                  style={[styles.rowText, { color: textColor }]}
                  numberOfLines={1}
                >
                  {label}
                </Text>
                {providerName !== undefined && providerName !== '' ? (
                  <Text
                    style={[styles.rowProvider, { color: secondaryColor }]}
                    numberOfLines={1}
                  >
                    {providerName}
                  </Text>
                ) : null}
              </View>
            </Pressable>
          </ContextMenu.Trigger>
          <ContextMenu.Content>
            <ContextMenu.Item key="pin" onSelect={pin.onToggle}>
              <ContextMenu.ItemTitle>
                {pin.pinned ? t('session.unpin') : t('session.pin')}
              </ContextMenu.ItemTitle>
              <ContextMenu.ItemIcon
                ios={{ name: pin.pinned ? 'pin.slash' : 'pin' }}
              />
            </ContextMenu.Item>
          </ContextMenu.Content>
        </ContextMenu.Root>
      </View>
      <View style={styles.rowTrail}>
        {effortSupported && effortLabel !== undefined ? (
          <Pressable
            onPress={onOpenEffort}
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
  const {
    visible,
    hide,
    onRequestClose,
    onDismiss: onModalDismiss,
  } = useDismissibleNativeModal(onClose);
  const deviceId = chat.deviceId;
  const catalog = useStore(catalogStore, s => s.byDevice[deviceId]);
  const catalogTick = catalog?.loadedAt ?? 0;
  const [query, setQuery] = useState('');
  const modelSettings = useModelSettingsMap();
  const pinnedModels = usePinnedModels();
  const [effort, setEffort] = useState<{
    harness: string;
    model: string;
    levels: string[];
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
    if (runtime === null) return;
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

  const pinnedSet = useMemo(
    () => new Set(pinnedModels.map(p => modelRowKey(p.harness, p.model))),
    [pinnedModels],
  );
  const pinnedVisible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const catalogRefs = harnesses
      .filter(h => !locked || h.id === harnessId)
      .flatMap(h =>
        modelsFor(deviceId, h.id).map(m => ({
          harness: h.id,
          model: m.id,
          label: m.label,
          harnessName: h.name,
        })),
      );
    return pinnedMenuModels(
      pinnedModels,
      catalogRefs,
      harnessId !== undefined
        ? { harness: harnessId, model: config?.model ?? '' }
        : undefined,
      locked,
    ).filter(m => {
      if (q === '') return true;
      return (
        m.label.toLowerCase().includes(q) ||
        m.model.toLowerCase().includes(q) ||
        (m.harnessName ?? '').toLowerCase().includes(q)
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    pinnedModels,
    harnesses,
    deviceId,
    catalogTick,
    query,
    locked,
    harnessId,
    config?.model,
  ]);

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
      else if (runtime !== null) setChatConfig(runtime, chat.id, next);
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
      const siblings = modelsFor(deviceId, harness);
      const stored = modelSettings[modelRowKey(harness, model.id)];
      const selectedLive =
        harness === harnessId && config?.model === model.id
          ? {
              reasoning: config?.reasoning,
              modelOptions: config?.modelOptions,
            }
          : undefined;
      const picked = selectionForModel(
        model,
        siblings,
        harnesses.find(h => h.id === harness)?.reasoningLevels,
        stored,
        selectedLive,
      );
      apply({
        harness,
        model: model.id,
        reasoning: picked.reasoning,
        modelOptions: picked.modelOptions,
        ...extra,
      });
    },
    [apply, locked, harnessId, harnesses, config, modelSettings, deviceId],
  );

  const pinFor = useCallback(
    (harness: string, modelId: string) => {
      const pinned = pinnedSet.has(modelRowKey(harness, modelId));
      return {
        pinned,
        onToggle: () => togglePinnedModel({ harness, model: modelId }),
      };
    },
    [pinnedSet],
  );

  const header = (
    <View style={styles.header}>
      <Pressable
        onPress={hide}
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
      <GlassControl
        interactive
        tintColor={theme.planButton}
        onPress={hide}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={t('common.done')}
        style={styles.closeButton}
      >
        <Icon name="checkmark" size={16} color={DONE_CHECK} />
      </GlassControl>
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

      {pinnedVisible.length > 0 ? (
        <View key="pinned">
          <Text
            style={[styles.groupHead, { color: theme.textSecondary }]}
            accessibilityRole="header"
            accessibilityLabel={t('home.pinned')}
          >
            {t('home.pinned')}
          </Text>
          {pinnedVisible.map((ref, i) => {
            const h = harnesses.find(x => x.id === ref.harness);
            const siblings = modelsFor(deviceId, ref.harness);
            const m = siblings.find(x => x.id === ref.model);
            if (h === undefined || m === undefined) return null;
            const selected = m.id === config?.model && h.id === harnessId;
            const stored = modelSettings[modelRowKey(h.id, m.id)];
            const traits = resolveModelTraits(
              m,
              siblings,
              h.reasoningLevels,
              selected
                ? {
                    reasoning: config?.reasoning,
                    modelOptions: config?.modelOptions,
                  }
                : {
                    reasoning: stored?.reasoning,
                    modelOptions: stored?.modelOptions,
                  },
            );
            const effortSupported = (traits.effort?.levels.length ?? 0) > 0;
            const rowOptions = rememberedModelOptions(
              stored,
              m.options,
              selected ? config?.modelOptions : undefined,
            );
            return (
              <ModelRow
                key={`pinned:${h.id}:${m.id}`}
                label={m.label}
                selected={selected}
                unavailable={selected && !health.modelOk}
                effortSupported={effortSupported}
                effortLabel={
                  effortSupported && traits.effort?.value !== undefined
                    ? capitalizeLevel(traits.effort.value)
                    : undefined
                }
                onSelect={() => pickModel(h.id, m)}
                onOpenEffort={() => {
                  pickModel(h.id, m);
                  setEffort({
                    harness: h.id,
                    model: m.id,
                    levels: traits.effort?.levels ?? [],
                  });
                }}
                fastSupported={traits.fast !== undefined}
                fastOption={traits.fast?.option}
                fastEnabled={traits.fast?.enabled ?? false}
                fastChoice={traits.fast?.choice}
                onSelectFast={choiceId => {
                  const patch = applyFastChoice(
                    traits,
                    choiceId,
                    {
                      model: m.id,
                      reasoning: selected
                        ? config?.reasoning
                        : stored?.reasoning,
                      modelOptions: rowOptions,
                    },
                    siblings,
                  );
                  pickModel(h.id, m, {
                    model: patch.model,
                    reasoning: patch.reasoning,
                    modelOptions: patch.modelOptions,
                  });
                }}
                last={i === pinnedVisible.length - 1}
                borderColor={theme.border}
                textColor={theme.text}
                secondaryColor={theme.textSecondary}
                dangerColor={theme.danger}
                accentColor={theme.accent}
                harnessId={h.id}
                providerName={h.name}
                pin={pinFor(h.id, m.id)}
              />
            );
          })}
        </View>
      ) : null}

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
            const stored = modelSettings[modelRowKey(h.id, m.id)];
            const traits = resolveModelTraits(
              m,
              models,
              h.reasoningLevels,
              selected
                ? {
                    reasoning: config?.reasoning,
                    modelOptions: config?.modelOptions,
                  }
                : {
                    reasoning: stored?.reasoning,
                    modelOptions: stored?.modelOptions,
                  },
            );
            const effortSupported = (traits.effort?.levels.length ?? 0) > 0;
            const rowOptions = rememberedModelOptions(
              stored,
              m.options,
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
                  effortSupported && traits.effort?.value !== undefined
                    ? capitalizeLevel(traits.effort.value)
                    : undefined
                }
                onSelect={() => pickModel(h.id, m)}
                onOpenEffort={() => {
                  pickModel(h.id, m);
                  setEffort({
                    harness: h.id,
                    model: m.id,
                    levels: traits.effort?.levels ?? [],
                  });
                }}
                fastSupported={traits.fast !== undefined}
                fastOption={traits.fast?.option}
                fastEnabled={traits.fast?.enabled ?? false}
                fastChoice={traits.fast?.choice}
                onSelectFast={choiceId => {
                  const patch = applyFastChoice(
                    traits,
                    choiceId,
                    {
                      model: m.id,
                      reasoning: selected
                        ? config?.reasoning
                        : stored?.reasoning,
                      modelOptions: rowOptions,
                    },
                    models,
                  );
                  pickModel(h.id, m, {
                    model: patch.model,
                    reasoning: patch.reasoning,
                    modelOptions: patch.modelOptions,
                  });
                }}
                last={i === models.length - 1}
                borderColor={theme.border}
                textColor={theme.text}
                secondaryColor={theme.textSecondary}
                dangerColor={theme.danger}
                accentColor={theme.accent}
                pin={pinFor(h.id, m.id)}
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

  const effortLevels = effort?.levels ?? [];
  const effortModel =
    effort === undefined
      ? undefined
      : modelsFor(deviceId, effort.harness).find(m => m.id === effort.model);
  const effortTraits =
    effort === undefined
      ? undefined
      : resolveModelTraits(
          effortModel,
          modelsFor(deviceId, effort.harness),
          harnesses.find(h => h.id === effort.harness)?.reasoningLevels,
          config?.harness === effort.harness
            ? {
                reasoning: config?.reasoning,
                modelOptions: config?.modelOptions,
              }
            : {
                reasoning:
                  modelSettings[modelRowKey(effort.harness, effort.model)]
                    ?.reasoning,
                modelOptions:
                  modelSettings[modelRowKey(effort.harness, effort.model)]
                    ?.modelOptions,
              },
        );
  const effortValue = effortTraits?.effort?.value;

  const overlay =
    effort !== undefined ? (
      <EffortOverlay
        embedded
        levels={effortLevels}
        value={effortValue}
        onChange={level => {
          const siblings = modelsFor(deviceId, effort.harness);
          const patch = applyEffortLevel(
            effortTraits ?? {},
            level,
            {
              model: effort.model,
              reasoning: config?.reasoning,
              modelOptions: config?.modelOptions ?? {},
            },
            siblings,
          );
          apply({
            harness: effort.harness,
            model: patch.model ?? effort.model,
            reasoning: patch.reasoning,
            modelOptions: patch.modelOptions,
          });
          if (patch.model !== undefined && patch.model !== effort.model) {
            setEffort({
              harness: effort.harness,
              model: patch.model,
              levels: effort.levels,
            });
          }
        }}
        onDismiss={() => setEffort(undefined)}
      />
    ) : null;

  const body = (
    <View style={[styles.sheetBody, { backgroundColor: theme.background }]}>
      {header}
      {content}
      <MenuDismissShield />
      {overlay}
    </View>
  );

  return (
    <Modal
      visible={visible}
      presentationStyle={formSheet === true ? 'formSheet' : 'pageSheet'}
      animationType={formSheet === true ? 'fade' : 'slide'}
      allowSwipeDismissal
      onRequestClose={onRequestClose}
      onDismiss={onModalDismiss}
    >
      <View style={[styles.modalFill, { backgroundColor: theme.background }]}>
        {body}
      </View>
    </Modal>
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
    overflow: 'hidden',
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
  rowHitWrap: { flex: 1, minWidth: 0 },
  rowHit: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  rowLabel: { flex: 1, minWidth: 0, justifyContent: 'center' },
  rowText: { fontSize: 17, flexShrink: 1 },
  rowProvider: { fontSize: 12, marginTop: 1 },
  rowTrail: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 0,
    gap: 20,
    marginLeft: 'auto',
  },
  badge: { fontSize: 11, fontWeight: '600' },
  checkSpacer: { width: 16 },
});
