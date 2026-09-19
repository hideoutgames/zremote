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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
import { fastOptionForModel, isFastEnabled } from './fastMode';
import { capitalizeLevel } from './effortSliderMath';
import { useRuntime } from '../app/runtimeContext';
import { loadCatalog, loadModels } from '../zeron/runtime/catalog';
import { createThreadFromCompose } from '../zeron/runtime/createThreadFromCompose';
import {
  catalogStore,
  modelsFor,
  reasoningLevelsFor,
  selectableHarnesses,
} from '../zeron/state/catalogStore';
import {
  COMPOSE_DRAFT_ID,
  setDraftPendingWorktree,
  useDraft,
} from '../zeron/state/draftStore';
import { recentMenuModels } from '../zeron/state/recentModels';
import {
  setComposeDefaults,
  useComposeDefaults,
  useRecentModels,
  type ComposeDefaults,
} from '../zeron/state/uiPrefs';
import { workspaceStore } from '../zeron/state/workspaceStore';
import {
  dictationUnavailable,
  resolveDictationPort,
  type DictationPort,
} from '../zeron/native/dictation';
import {
  FULL_ACCESS_SANDBOX,
  type Chat,
  type ChatConfig,
  type DeviceRow,
  type RepoRef,
  type Space,
} from '../zeron/protocol/types';
import type { SendPlan } from '../zeron/attachments/sendPlan';
import { t } from '../i18n/strings';

export function ComposeComposer({
  onCreated,
  autoFocus = false,
  sticky = false,
  composerMaxWidth,
  onLayout,
}: {
  onCreated: (chatId: string) => void;
  autoFocus?: boolean;
  sticky?: boolean;
  composerMaxWidth?: number;
  onLayout?: (event: LayoutChangeEvent) => void;
}) {
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const runtime = useRuntime();
  const devices = useStore(workspaceStore, s => s.devices);
  const spaces = useStore(workspaceStore, s => s.spaces);
  const saved = useComposeDefaults();
  const recents = useRecentModels();
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
  const [modelOptions, setModelOptions] = useState<Record<string, unknown>>({});
  const [branch, setBranch] = useState<string | undefined>(undefined);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [effortOpen, setEffortOpen] = useState(false);
  const [effortOrigin, setEffortOrigin] = useState<EffortOrigin | undefined>(
    undefined,
  );
  const [effortAnchor, setEffortAnchor] = useState<EffortOrigin | undefined>(
    undefined,
  );
  const [dictation, setDictation] =
    useState<DictationPort>(dictationUnavailable);
  const composerRef = useRef<View>(null);
  const wrapRef = useRef<View>(null);

  useEffect(() => {
    let mounted = true;
    resolveDictationPort().then(port => {
      if (mounted) setDictation(port);
    });
    return () => {
      mounted = false;
    };
  }, []);

  // Saved compose defaults / "new in this space" can land after mount.
  useEffect(() => {
    if (saved === undefined) return;
    if (saved.deviceId !== '') setDeviceId(saved.deviceId);
    setSpaceId(saved.spaceId);
    if (saved.harness !== '') setHarness(saved.harness);
    if (saved.model !== '') setModel(saved.model);
    setReasoning(saved.reasoning);
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
        ...patch,
      });
    },
    [deviceId, spaceId, harness, model, reasoning],
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
    if (runtime === null || deviceId === '' || harness === '') return;
    if (modelsFor(deviceId, harness).length === 0)
      loadModels(runtime, deviceId, harness).catch(() => {});
  }, [runtime, deviceId, harness, catalogTick]);

  const catalogModels = useMemo(() => {
    if (deviceId === '') return [];
    const out: { harness: string; model: string; label: string }[] = [];
    for (const h of selectableHarnesses(deviceId)) {
      for (const m of modelsFor(deviceId, h.id)) {
        out.push({ harness: h.id, model: m.id, label: m.label });
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
  const effortLevels =
    deviceId === '' || harness === ''
      ? []
      : reasoningLevelsFor(deviceId, harness, model);
  const fastOption = fastOptionForModel(currentModel);
  const fastEnabled = isFastEnabled(modelOptions, fastOption);
  const modelLabel =
    currentModel?.label ?? (model === '' ? t('picker.default') : model);
  const effortLabel = capitalizeLevel(
    reasoning ?? effortLevels[0] ?? t('picker.effort'),
  );
  const harnessDesc = catalog?.harnesses.find(h => h.id === harness);
  const recentItems = useMemo(
    () =>
      recentMenuModels(
        recents,
        catalogModels,
        harness !== '' && model !== '' ? { harness, model } : undefined,
        3,
        false,
      ),
    [recents, catalogModels, harness, model],
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
        sandbox: FULL_ACCESS_SANDBOX,
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
  });

  const submit = useCallback(
    async (
      text: string,
      withAttachments: boolean,
    ): Promise<SendPlan | void> => {
      if (runtime === null) return withAttachments ? 'blocked' : undefined;
      if (deviceId === '' || harness === '') {
        Alert.alert(t('newSession.pickHost'));
        return withAttachments ? 'blocked' : undefined;
      }
      const chatId = await createThreadFromCompose(runtime, {
        text,
        settings: settings(),
        worktree: draft.pendingWorktree,
        branch:
          space !== undefined ? branch ?? DEFAULT_COMPOSE_BRANCH : undefined,
        attachments: withAttachments ? draft.attachments : undefined,
      });
      onCreated(chatId);
      return withAttachments ? 'legacy' : undefined;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      runtime,
      deviceId,
      harness,
      spaceId,
      model,
      reasoning,
      draft,
      branch,
      onCreated,
    ],
  );

  const onSend = useCallback(
    (text: string) => {
      submit(text, false).catch(() => {});
    },
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
      style={
        composerMaxWidth !== undefined
          ? [styles.measureCap, { maxWidth: composerMaxWidth }]
          : undefined
      }
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
          setHarness(h);
          setModel(m);
          persist({ harness: h, model: m });
        }}
        onOpenMoreModels={() => setPickerOpen(true)}
        effortLabel={effortLabel}
        effortSupported={effortLevels.length > 0}
        fastSupported={fastOption !== undefined}
        fastOption={fastOption}
        fastEnabled={fastEnabled}
        fastChoice={
          fastOption === undefined
            ? undefined
            : typeof modelOptions[fastOption.id] === 'string'
            ? (modelOptions[fastOption.id] as string)
            : fastOption.defaultChoice
        }
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
          if (fastOption === undefined) return;
          setModelOptions({
            ...modelOptions,
            [fastOption.id]: choice,
          });
        }}
        checkout={checkout}
        dictation={dictation}
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
      value={reasoning}
      origin={effortOrigin}
      anchor={effortAnchor}
      onChange={level => {
        setReasoning(level);
        persist({ reasoning: level });
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
      <KeyboardStickyView
        offset={{ opened: insets.bottom }}
        style={styles.sticky}
      >
        {composer}
      </KeyboardStickyView>
    </>
  );
}

const styles = StyleSheet.create({
  sticky: { width: '100%' },
  measureCap: { width: '100%', alignSelf: 'center' },
});
