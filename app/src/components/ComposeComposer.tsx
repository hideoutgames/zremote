// Compose-mode wiring around the shared Composer: Desktop / Project /
// checkout-mode / Branch sit between the grabber and the input, the model
// picker is unlocked, drafts live at `__compose__`, and send creates the
// thread then runs.

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Alert,
  Keyboard,
  type LayoutChangeEvent,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { KeyboardStickyView } from 'react-native-keyboard-controller';
import { useStore } from 'zustand';
import { Composer } from './Composer';
import { DEFAULT_COMPOSE_BRANCH } from './CheckoutSelector';
import {
  EffortOverlay,
  measureWindowRect,
  type EffortOrigin,
} from './EffortOverlay';
import { REGULAR_MIN_WIDTH } from '../navigation/layout';
import { ModelPickerSheet } from './ModelPickerSheet';
import { capitalizeLevel } from './effortSliderMath';
import {
  applyContextChoice,
  applyEffortLevel,
  applyFastChoice,
  resolveModelTraits,
  selectionForModel,
} from './modelTraits';
import { useRuntime } from '../app/runtimeContext';
import { loadCatalog, loadModels } from '../zeron/runtime/catalog';
import { createThreadFromCompose } from '../zeron/runtime/createThreadFromCompose';
import {
  catalogStore,
  modelsFor,
  selectableHarnesses,
} from '../zeron/state/catalogStore';
import {
  COMPOSE_DRAFT_ID,
  clearDraft,
  setDraftPendingWorktree,
  useDraft,
} from '../zeron/state/draftStore';
import { composerMenuModels } from '../zeron/state/pinnedModels';
import {
  modelSettingsFor,
  rememberModelSettings,
  setComposeDefaults,
  useComposeDefaults,
  usePinnedModels,
  useRecentModels,
  useVoiceInputMode,
  type ComposeDefaults,
} from '../zeron/state/uiPrefs';
import { workspaceStore } from '../zeron/state/workspaceStore';
import { isPresenceFresh } from '../zeron/protocol/entities';
import { alertHostNotConnectedQueue } from './queueAlerts';
import {
  dictationUnavailable,
  resolveDictationPort,
  type DictationPort,
} from '../zeron/native/dictation';
import {
  DESKTOP_SANDBOX,
  type Chat,
  type ChatConfig,
  type DeviceRow,
  type RepoRef,
  type Space,
} from '../zeron/protocol/types';
import type { SendPlan } from '../zeron/attachments/sendPlan';
import { t } from '../i18n/strings';
import { useLocalVoiceRuntime } from '../hooks/useLocalVoiceRuntime';
import type { WorkspaceCommand } from '../zeron/composer/completion';

export function ComposeComposer({
  onCreated,
  autoFocus = false,
  sticky = false,
  composerMaxWidth,
  onLayout,
  onWorkspaceCommand,
}: {
  onCreated: (chatId: string) => void;
  autoFocus?: boolean;
  sticky?: boolean;
  composerMaxWidth?: number;
  onLayout?: (event: LayoutChangeEvent) => void;
  /** `/model`, `/new` resolve here; the rest delegate to the screen. */
  onWorkspaceCommand?: (command: WorkspaceCommand) => void;
}) {
  const { width: windowWidth } = useWindowDimensions();
  const runtime = useRuntime();
  const devices = useStore(workspaceStore, s => s.devices);
  const spaces = useStore(workspaceStore, s => s.spaces);
  const saved = useComposeDefaults();
  const recents = useRecentModels();
  const pinnedModels = usePinnedModels();
  const draft = useDraft(COMPOSE_DRAFT_ID);

  const [deviceId, setDeviceId] = useState(
    () => saved?.deviceId || devices[0]?.id || '',
  );
  const [spaceId, setSpaceId] = useState<string | undefined>(
    () => saved?.spaceId,
  );
  const [harness, setHarness] = useState(() => saved?.harness ?? '');
  const [model, setModel] = useState(
    () => saved?.model ?? recents[0]?.model ?? '',
  );
  const [reasoning, setReasoning] = useState<string | undefined>(
    saved?.reasoning,
  );
  const [modelOptions, setModelOptions] = useState<Record<string, unknown>>(
    () =>
      saved !== undefined
        ? modelSettingsFor(saved.harness, saved.model)?.modelOptions ?? {}
        : {},
  );
  const [branch, setBranch] = useState<string | undefined>(undefined);
  const [pickerOpen, setPickerOpen] = useState(false);
  // /model and /new resolve inside compose; the rest go to the screen.
  const onComposerWorkspaceCommand = useCallback(
    (command: WorkspaceCommand) => {
      if (command === 'model') setPickerOpen(true);
      else if (command === 'new') clearDraft(COMPOSE_DRAFT_ID);
      else onWorkspaceCommand?.(command);
    },
    [onWorkspaceCommand],
  );
  const [effortOpen, setEffortOpen] = useState(false);
  const [effortOrigin, setEffortOrigin] = useState<EffortOrigin | undefined>(
    undefined,
  );
  const [effortAnchor, setEffortAnchor] = useState<EffortOrigin | undefined>(
    undefined,
  );
  const [dictation, setDictation] =
    useState<DictationPort>(dictationUnavailable);
  const voiceInputMode = useVoiceInputMode();
  const voiceRuntime = useLocalVoiceRuntime(voiceInputMode === 'voiceModel');
  const composerRef = useRef<View>(null);
  const wrapRef = useRef<View>(null);

  useEffect(() => {
    if (voiceInputMode !== 'dictation') {
      setDictation(dictationUnavailable);
      return;
    }
    let mounted = true;
    resolveDictationPort().then(port => {
      if (mounted) setDictation(port);
    });
    return () => {
      mounted = false;
    };
  }, [voiceInputMode]);

  // Saved compose defaults / "new in this space" can land after mount.
  useEffect(() => {
    if (saved === undefined) return;
    if (saved.deviceId !== '') setDeviceId(saved.deviceId);
    setSpaceId(saved.spaceId);
    if (saved.harness !== '') setHarness(saved.harness);
    if (saved.model !== '') setModel(saved.model);
    setReasoning(saved.reasoning);
    setModelOptions(
      saved.modelOptions ??
        (saved.harness !== '' && saved.model !== ''
          ? modelSettingsFor(saved.harness, saved.model)?.modelOptions ?? {}
          : {}),
    );
  }, [saved]);

  useEffect(() => {
    if (deviceId === '' && devices[0] !== undefined) setDeviceId(devices[0].id);
  }, [deviceId, devices]);

  const persist = useCallback(
    (patch: Partial<ComposeDefaults>) => {
      setComposeDefaults({
        deviceId,
        spaceId,
        harness,
        model,
        reasoning,
        modelOptions,
        ...patch,
      });
    },
    [deviceId, spaceId, harness, model, reasoning, modelOptions],
  );

  const host: DeviceRow | undefined = devices.find(d => d.id === deviceId);
  const space: Space | undefined =
    spaceId === undefined ? undefined : spaces.find(s => s.id === spaceId);

  const catalog = useStore(catalogStore, s =>
    deviceId === '' ? undefined : s.byDevice[deviceId],
  );
  const catalogTick = catalog?.loadedAt ?? 0;

  useEffect(() => {
    if (runtime === null || deviceId === '') return;
    if (catalog === undefined)
      loadCatalog(runtime, deviceId, { allowMockHarness: true }).catch(
        () => {},
      );
  }, [runtime, deviceId, catalog]);

  const harnesses = useMemo(
    () => (deviceId === '' ? [] : selectableHarnesses(deviceId)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [deviceId, catalogTick],
  );

  useEffect(() => {
    if (harness === '' && harnesses[0] !== undefined) {
      setHarness(harnesses[0].id);
      persist({ harness: harnesses[0].id });
    }
  }, [harness, harnesses, persist]);

  useEffect(() => {
    if (runtime === null || deviceId === '') return;
    for (const h of harnesses) {
      if (modelsFor(deviceId, h.id).length === 0)
        loadModels(runtime, deviceId, h.id).catch(() => {});
    }
  }, [runtime, deviceId, harnesses, catalogTick]);

  const catalogModels = useMemo(() => {
    if (deviceId === '') return [];
    const out: {
      harness: string;
      model: string;
      label: string;
      harnessName: string;
    }[] = [];
    for (const h of selectableHarnesses(deviceId)) {
      for (const m of modelsFor(deviceId, h.id)) {
        out.push({
          harness: h.id,
          model: m.id,
          label: m.label,
          harnessName: h.name,
        });
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceId, catalogTick]);

  useEffect(() => {
    if (model !== '') return;
    const first =
      catalogModels.find(m => m.harness === harness) ?? catalogModels[0];
    if (first !== undefined) {
      setHarness(first.harness);
      setModel(first.model);
      persist({ harness: first.harness, model: first.model });
    }
  }, [model, catalogModels, harness, persist]);

  const currentModel =
    deviceId === '' || harness === ''
      ? undefined
      : modelsFor(deviceId, harness).find(m => m.id === model);
  const harnessModels =
    deviceId === '' || harness === '' ? [] : modelsFor(deviceId, harness);
  const traits = resolveModelTraits(
    currentModel,
    harnessModels,
    harnesses.find(h => h.id === harness)?.reasoningLevels,
    { model, reasoning, modelOptions },
  );
  const effortLevels = traits.effort?.levels ?? [];
  const fastOption = traits.fast?.option;
  const fastEnabled = traits.fast?.enabled ?? false;
  const contextOption = traits.context?.option;
  const contextChoice = traits.context?.choice;
  const modelLabel =
    currentModel?.label ?? (model === '' ? t('picker.default') : model);
  const effortLabel = capitalizeLevel(
    traits.effort?.value ?? t('picker.effort'),
  );
  const harnessDesc = catalog?.harnesses.find(h => h.id === harness);
  const recentItems = useMemo(
    () =>
      composerMenuModels(
        pinnedModels,
        recents,
        catalogModels,
        harness !== '' && model !== '' ? { harness, model } : undefined,
        false,
      ),
    [pinnedModels, recents, catalogModels, harness, model],
  );

  const composeChat: Chat = useMemo(
    () => ({
      id: COMPOSE_DRAFT_ID,
      deviceId,
      spaceId,
      archived: false,
      createdAt: 0,
      cwd: space?.path,
      branch: draft.pendingWorktree?.base ?? branch,
      config: {
        harness,
        model: model === '' ? undefined : model,
        reasoning,
        sandbox: DESKTOP_SANDBOX,
        modelOptions,
      },
    }),
    [
      deviceId,
      spaceId,
      space?.path,
      draft.pendingWorktree?.base,
      branch,
      harness,
      model,
      reasoning,
      modelOptions,
    ],
  );

  const settings = (): ComposeDefaults => ({
    deviceId,
    spaceId,
    harness,
    model,
    reasoning,
    modelOptions,
  });

  const submit = useCallback(
    async (
      text: string,
      withAttachments: boolean,
    ): Promise<SendPlan | boolean> => {
      if (runtime === null) return withAttachments ? 'blocked' : false;
      if (deviceId === '' || harness === '') {
        Alert.alert(t('newSession.pickHost'));
        return withAttachments ? 'blocked' : false;
      }
      try {
        const chatId = await createThreadFromCompose(runtime, {
          text,
          settings: settings(),
          worktree: draft.pendingWorktree,
          branch:
            space !== undefined ? branch ?? DEFAULT_COMPOSE_BRANCH : undefined,
          attachments: withAttachments ? draft.attachments : undefined,
        });
        onCreated(chatId);
        if (
          !isPresenceFresh(
            workspaceStore.getState().presence[deviceId],
            Date.now(),
          )
        ) {
          alertHostNotConnectedQueue();
        }
        return withAttachments ? 'legacy' : true;
      } catch {
        return withAttachments ? 'blocked' : false;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      runtime,
      deviceId,
      harness,
      spaceId,
      model,
      reasoning,
      modelOptions,
      draft,
      branch,
      onCreated,
    ],
  );

  const onSend = useCallback(
    (text: string): Promise<boolean> =>
      submit(text, false).then(result => result === true),
    [submit],
  );
  const onSendAttachments = useCallback(
    (text: string): Promise<SendPlan> =>
      submit(text, true).then(plan =>
        plan === 'blocked' || plan === 'legacy' || plan === 'queue'
          ? plan
          : 'blocked',
      ),
    [submit],
  );

  const applyConfig = useCallback(
    (next: ChatConfig) => {
      setHarness(next.harness);
      setModel(next.model ?? '');
      setReasoning(next.reasoning);
      setModelOptions(next.modelOptions ?? {});
      persist({
        harness: next.harness,
        model: next.model ?? '',
        reasoning: next.reasoning,
        modelOptions: next.modelOptions ?? {},
      });
    },
    [persist],
  );

  const onResolvedBranch = useCallback((name: string) => {
    setBranch(prev => prev ?? name);
  }, []);

  const checkout =
    runtime !== null
      ? {
          runtime,
          chat: composeChat,
          host,
          repoPath: space?.path,
          spaces,
          projectLabel:
            space?.name ??
            space?.path.split(/[\\/]/).filter(Boolean).pop() ??
            t('checkout.noProject'),
          checkoutModeLabel:
            draft.pendingWorktree !== undefined
              ? t('newSession.checkout.newWorktree')
              : t('newSession.checkout.current'),
          branchLabel: branch ?? DEFAULT_COMPOSE_BRANCH,
          machineLabel: host?.name ?? t('newSession.desktop'),
          hosts: devices,
          newWorktree: draft.pendingWorktree !== undefined,
          onSelectHost: (device: DeviceRow) => {
            setDeviceId(device.id);
            if (space !== undefined && space.deviceId !== device.id)
              setSpaceId(undefined);
            persist({
              deviceId: device.id,
              spaceId:
                space !== undefined && space.deviceId !== device.id
                  ? undefined
                  : spaceId,
            });
          },
          onSelectSpace: (next: Space | undefined) => {
            setSpaceId(next?.id);
            setBranch(undefined);
            if (next !== undefined && next.deviceId !== deviceId)
              setDeviceId(next.deviceId);
            persist({
              spaceId: next?.id,
              deviceId: next?.deviceId ?? deviceId,
            });
          },
          onSelectRef: (ref: RepoRef) => {
            setBranch(ref.name);
            if (draft.pendingWorktree !== undefined && space !== undefined) {
              setDraftPendingWorktree(COMPOSE_DRAFT_ID, {
                repoPath: space.path,
                base: ref.name,
              });
            }
          },
          onSelectCurrentCheckout: () => {
            setDraftPendingWorktree(COMPOSE_DRAFT_ID, undefined);
          },
          onSelectNewWorktree: (base: string) => {
            if (space === undefined) return;
            setDraftPendingWorktree(COMPOSE_DRAFT_ID, {
              repoPath: space.path,
              base,
            });
          },
          onResolvedBranch,
        }
      : undefined;

  const composer = (
    <View
      ref={wrapRef}
      style={[
        styles.measureCap,
        composerMaxWidth !== undefined
          ? { maxWidth: composerMaxWidth }
          : undefined,
      ]}
      testID="compose-composer"
    >
      <Composer
        chatId={COMPOSE_DRAFT_ID}
        mode="compose"
        autoFocus={autoFocus}
        phase="idle"
        roomState="idle"
        harness={harnessDesc}
        capabilities={new Set(host?.capabilities ?? [])}
        modelLabel={modelLabel}
        harnessId={harness === '' ? undefined : harness}
        recentItems={recentItems}
        onPickRecentModel={(h, m) => {
          const catalogModel = modelsFor(deviceId, h).find(row => row.id === m);
          const stored = modelSettingsFor(h, m);
          const picked = selectionForModel(
            catalogModel,
            modelsFor(deviceId, h),
            harnesses.find(row => row.id === h)?.reasoningLevels,
            stored,
          );
          setHarness(h);
          setModel(m);
          setReasoning(picked.reasoning);
          setModelOptions(picked.modelOptions);
          persist({
            harness: h,
            model: m,
            reasoning: picked.reasoning,
            modelOptions: picked.modelOptions,
          });
        }}
        onOpenMoreModels={() => setPickerOpen(true)}
        effortLabel={effortLabel}
        effortSupported={effortLevels.length > 0}
        fastSupported={traits.fast !== undefined}
        fastOption={fastOption}
        fastEnabled={fastEnabled}
        fastChoice={traits.fast?.choice}
        contextSupported={traits.context !== undefined}
        contextOption={contextOption}
        contextChoice={contextChoice}
        effortOpen={effortOpen}
        onOpenEffort={origin => {
          Keyboard.dismiss();
          setEffortOrigin(origin);
          if (windowWidth < REGULAR_MIN_WIDTH) {
            setEffortAnchor(undefined);
            setEffortOpen(true);
            return;
          }
          measureWindowRect(wrapRef.current, rect => {
            setEffortAnchor(rect);
            setEffortOpen(true);
          });
        }}
        onSelectFast={choice => {
          const patch = applyFastChoice(
            traits,
            choice,
            { model, reasoning, modelOptions },
            harnessModels,
          );
          if (patch.model !== undefined) setModel(patch.model);
          setReasoning(patch.reasoning);
          setModelOptions(patch.modelOptions);
          persist({
            ...(patch.model !== undefined ? { model: patch.model } : {}),
            reasoning: patch.reasoning,
            modelOptions: patch.modelOptions,
          });
          const nextModel = patch.model ?? model;
          if (harness !== '' && nextModel !== '')
            rememberModelSettings(harness, nextModel, {
              reasoning: patch.reasoning,
              modelOptions: patch.modelOptions,
            });
        }}
        onSelectContext={choice => {
          const patch = applyContextChoice(traits, choice, {
            model,
            reasoning,
            modelOptions,
          });
          if (patch.model !== undefined) setModel(patch.model);
          setReasoning(patch.reasoning);
          setModelOptions(patch.modelOptions);
          persist({
            ...(patch.model !== undefined ? { model: patch.model } : {}),
            reasoning: patch.reasoning,
            modelOptions: patch.modelOptions,
          });
          const nextModel = patch.model ?? model;
          if (harness !== '' && nextModel !== '')
            rememberModelSettings(harness, nextModel, {
              reasoning: patch.reasoning,
              modelOptions: patch.modelOptions,
            });
        }}
        checkout={checkout}
        completion={{ deviceId, spaceId, cwd: space?.path }}
        onWorkspaceCommand={onComposerWorkspaceCommand}
        dictation={dictation}
        voiceRuntime={voiceRuntime}
        onSend={onSend}
        onSteer={() => {}}
        onQueue={() => {}}
        onStop={() => {}}
        onCancel={() => {}}
        onSendAttachments={onSendAttachments}
        onRespondInput={() => {}}
        onSendBlocked={() => Alert.alert(t('session.attachmentsBlocked'))}
        composerRef={composerRef}
        onLayout={onLayout ?? (() => {})}
      />
      {pickerOpen && runtime !== null ? (
        <ModelPickerSheet
          runtime={runtime}
          chat={composeChat}
          phase="idle"
          onClose={() => setPickerOpen(false)}
          formSheet={windowWidth >= 700}
          lockHarness={false}
          onApplyConfig={applyConfig}
        />
      ) : null}
    </View>
  );

  const overlay = effortOpen ? (
    <EffortOverlay
      levels={effortLevels}
      value={traits.effort?.value}
      origin={effortOrigin}
      anchor={effortAnchor}
      onChange={level => {
        const patch = applyEffortLevel(
          traits,
          level,
          { model, reasoning, modelOptions },
          harnessModels,
        );
        if (patch.model !== undefined) setModel(patch.model);
        setReasoning(patch.reasoning);
        setModelOptions(patch.modelOptions);
        persist({
          ...(patch.model !== undefined ? { model: patch.model } : {}),
          reasoning: patch.reasoning,
          modelOptions: patch.modelOptions,
        });
        const nextModel = patch.model ?? model;
        if (harness !== '' && nextModel !== '')
          rememberModelSettings(harness, nextModel, {
            reasoning: patch.reasoning,
            modelOptions: patch.modelOptions,
          });
      }}
      onDismiss={() => {
        setEffortOpen(false);
        setEffortOrigin(undefined);
        setEffortAnchor(undefined);
      }}
    />
  ) : null;

  if (!sticky) {
    return (
      <>
        {overlay}
        {composer}
      </>
    );
  }
  return (
    <>
      {overlay}
      <KeyboardStickyView offset={{ opened: 0 }} style={styles.sticky}>
        {composer}
      </KeyboardStickyView>
    </>
  );
}

const styles = StyleSheet.create({
  sticky: { width: '100%', alignItems: 'center' },
  measureCap: { width: '100%' },
});
