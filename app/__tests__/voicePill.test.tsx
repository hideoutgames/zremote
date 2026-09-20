// VoicePill idle / processing UI, plus Composer stop cooldown (2s spinner).

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { ActivityIndicator } from 'react-native';
import { Composer } from '../src/components/Composer';
import { Icon } from '../src/components/Icon';
import { VoicePill } from '../src/components/VoicePill';
import { VOICE_PILL_PROCESS_MS } from '../src/components/voicePillMath';
import { resetDrafts, setDraftText } from '../src/zeron/state/draftStore';
import { resetSessionStores } from '../src/zeron/state/sessionStores';
import type { DictationPort } from '../src/zeron/native/dictation';
import { setVoiceInputMode } from '../src/zeron/state/uiPrefs';
import type { LocalVoiceRuntime } from '../src/zeron/voice';

const renderPill = async (
  props: Partial<React.ComponentProps<typeof VoicePill>> = {},
) => {
  let tree: TestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    tree = TestRenderer.create(
      <VoicePill
        active={false}
        supported
        onToggle={() => {}}
        onCancel={() => {}}
        {...props}
      />,
    );
  });
  return tree!;
};

const pillButton = (root: TestRenderer.ReactTestInstance) =>
  root.find(
    n =>
      n.props.accessibilityRole === 'button' &&
      typeof n.props.accessibilityLabel === 'string',
  );

test('idle supported pill shows the mic and is pressable', async () => {
  const tree = await renderPill();
  const btn = pillButton(tree.root);
  expect(btn.props.accessibilityLabel).toBe('Dictate');
  expect(btn.props.accessibilityState).toEqual({
    disabled: false,
    busy: false,
  });
  expect(tree.root.findByType(Icon).props.name).toBe('mic');
  expect(tree.root.findAllByType(ActivityIndicator)).toHaveLength(0);
  act(() => {
    tree.unmount();
  });
});

test('processing replaces the mic with a disabled spinner', async () => {
  const onToggle = jest.fn();
  const tree = await renderPill({ processing: true, onToggle });
  const btn = pillButton(tree.root);
  expect(btn.props.accessibilityLabel).toBe('Processing…');
  expect(btn.props.accessibilityState).toEqual({
    disabled: true,
    busy: true,
  });
  expect(tree.root.findAllByType(ActivityIndicator)).toHaveLength(1);
  expect(tree.root.findAllByType(Icon)).toHaveLength(0);
  await act(async () => {
    btn.props.onPress();
  });
  expect(onToggle).not.toHaveBeenCalled();
  act(() => {
    tree.unmount();
  });
});

test('active pill is labelled Stop dictation', async () => {
  const tree = await renderPill({ active: true });
  const btn = pillButton(tree.root);
  expect(btn.props.accessibilityLabel).toBe('Stop dictation');
  expect(btn.props.accessibilityState).toEqual({
    disabled: false,
    busy: true,
  });
  expect(tree.root.findByType(Icon).props.name).toBe('stop.fill');
  act(() => {
    tree.unmount();
  });
});

const composerProps = {
  chatId: 'c1',
  phase: 'idle' as const,
  roomState: 'connected' as const,
  harness: undefined,
  capabilities: new Set<string>(),
  modelLabel: 'Default',
  harnessId: 'claude-code',
  recentItems: [{ harness: 'claude-code', model: 'sonnet', label: 'Sonnet' }],
  onPickRecentModel: () => {},
  onOpenMoreModels: () => {},
  effortLabel: 'High',
  effortSupported: true,
  fastSupported: false,
  fastEnabled: false,
  onOpenEffort: () => {},
  onSelectFast: () => {},
  onSend: () => {},
  onSteer: () => {},
  onQueue: () => {},
  onStop: () => {},
  onCancel: () => {},
  onSendAttachments: () => Promise.resolve('sent' as never),
  onRespondInput: () => {},
  onSendBlocked: () => {},
};

const supportedPort = (): DictationPort => ({
  isSupported: jest.fn(async () => ({
    supported: true,
    onDevice: true,
  })),
  start: jest.fn(async () => {}),
  stop: jest.fn(async () => {}),
  cancel: jest.fn(async () => {}),
});

const renderComposer = async (
  dictation: DictationPort,
  extra: Partial<React.ComponentProps<typeof Composer>> = {},
) => {
  let tree: TestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    tree = TestRenderer.create(
      <Composer {...composerProps} {...extra} dictation={dictation} />,
    );
  });
  return tree!;
};

const voiceButton = (root: TestRenderer.ReactTestInstance) =>
  root.findByType(VoicePill);

const sendButton = (root: TestRenderer.ReactTestInstance) =>
  root.find(
    n =>
      n.props.accessibilityRole === 'button' &&
      n.props.accessibilityLabel === 'Send',
  );

beforeEach(() => {
  resetDrafts();
  setVoiceInputMode('dictation');
});

afterEach(() => {
  resetSessionStores();
  jest.useRealTimers();
});

test('stopping dictation disables the pill with a spinner for 2s', async () => {
  jest.useFakeTimers();
  const dictation = supportedPort();
  const tree = await renderComposer(dictation);
  await act(async () => {
    voiceButton(tree.root).props.onToggle();
  });
  expect(dictation.start).toHaveBeenCalledTimes(1);
  await act(async () => {
    voiceButton(tree.root).props.onToggle();
  });
  expect(dictation.stop).toHaveBeenCalled();
  const processing = voiceButton(tree.root);
  expect(processing.props.processing).toBe(true);
  expect(processing.props.active).toBe(false);
  expect(processing.findAllByType(ActivityIndicator)).toHaveLength(1);
  expect(pillButton(processing).props.accessibilityState.disabled).toBe(true);
  await act(async () => {
    processing.props.onToggle();
  });
  expect(dictation.start).toHaveBeenCalledTimes(1);
  await act(async () => {
    jest.advanceTimersByTime(VOICE_PILL_PROCESS_MS);
  });
  const idle = voiceButton(tree.root);
  expect(idle.props.processing).toBe(false);
  expect(idle.findByType(Icon).props.name).toBe('mic');
  expect(pillButton(idle).props.accessibilityState.disabled).toBe(false);
  act(() => {
    tree.unmount();
  });
  jest.useRealTimers();
});

test('cancelling dictation does not show the processing spinner', async () => {
  jest.useFakeTimers();
  const dictation = supportedPort();
  const tree = await renderComposer(dictation);
  await act(async () => {
    voiceButton(tree.root).props.onToggle();
  });
  await act(async () => {
    voiceButton(tree.root).props.onCancel();
  });
  expect(dictation.cancel).toHaveBeenCalledTimes(1);
  const pill = voiceButton(tree.root);
  expect(pill.props.processing).toBe(false);
  expect(pill.props.active).toBe(false);
  expect(pill.findAllByType(ActivityIndicator)).toHaveLength(0);
  expect(pill.findByType(Icon).props.name).toBe('mic');
  act(() => {
    tree.unmount();
  });
  jest.useRealTimers();
});

const expectSendCovered = (
  root: TestRenderer.ReactTestInstance,
  covered: boolean,
) => {
  const send = sendButton(root);
  expect(send.props.disabled).toBe(covered);
  expect(send.props.accessibilityState.disabled).toBe(covered);
  expect(send.props.accessibilityElementsHidden).toBe(covered);
  expect(send.props.importantForAccessibility).toBe(
    covered ? 'no-hide-descendants' : 'auto',
  );
  expect(send.props.pointerEvents).toBe(covered ? 'none' : 'auto');
};

test('dictating and processing cover send; send re-enables after 2s', async () => {
  jest.useFakeTimers();
  const dictation = supportedPort();
  const onSend = jest.fn();
  await act(async () => {
    setDraftText('c1', 'hello');
  });
  const tree = await renderComposer(dictation, { onSend });
  expectSendCovered(tree.root, false);

  await act(async () => {
    voiceButton(tree.root).props.onToggle();
  });
  expect(voiceButton(tree.root).props.active).toBe(true);
  expectSendCovered(tree.root, true);
  await act(async () => {
    sendButton(tree.root).props.onPress?.();
  });
  expect(onSend).not.toHaveBeenCalled();

  await act(async () => {
    voiceButton(tree.root).props.onToggle();
  });
  expect(voiceButton(tree.root).props.processing).toBe(true);
  expect(voiceButton(tree.root).props.active).toBe(false);
  expectSendCovered(tree.root, true);
  await act(async () => {
    sendButton(tree.root).props.onPress?.();
  });
  expect(onSend).not.toHaveBeenCalled();

  await act(async () => {
    jest.advanceTimersByTime(VOICE_PILL_PROCESS_MS);
  });
  expect(voiceButton(tree.root).props.processing).toBe(false);
  expectSendCovered(tree.root, false);
  await act(async () => {
    sendButton(tree.root).props.onPress();
  });
  expect(onSend).toHaveBeenCalledTimes(1);
  act(() => {
    tree.unmount();
  });
  jest.useRealTimers();
});

test('cancelling dictation uncovers send without a processing lock', async () => {
  jest.useFakeTimers();
  const dictation = supportedPort();
  const onSend = jest.fn();
  await act(async () => {
    setDraftText('c1', 'hello');
  });
  const tree = await renderComposer(dictation, { onSend });
  await act(async () => {
    voiceButton(tree.root).props.onToggle();
  });
  expectSendCovered(tree.root, true);
  await act(async () => {
    voiceButton(tree.root).props.onCancel();
  });
  expect(voiceButton(tree.root).props.active).toBe(false);
  expect(voiceButton(tree.root).props.processing).toBe(false);
  expectSendCovered(tree.root, false);
  await act(async () => {
    sendButton(tree.root).props.onPress();
  });
  expect(onSend).toHaveBeenCalledTimes(1);
  act(() => {
    tree.unmount();
  });
  jest.useRealTimers();
});

test('disabled voice input hides the microphone control', async () => {
  setVoiceInputMode('disabled');
  const tree = await renderComposer(supportedPort());
  expect(tree.root.findAllByType(VoicePill)).toHaveLength(0);
  act(() => {
    tree.unmount();
  });
});

test('voice model processing spinner lasts until transcription finishes', async () => {
  jest.useFakeTimers();
  setVoiceInputMode('voiceModel');
  let finish: (v: { text: string }) => void = () => {};
  const runtime: LocalVoiceRuntime = {
    capture: {
      start: async () => {},
      stop: async () => ({ uri: 'file://rec.wav', durationMs: 500 }),
      cancel: async () => {},
    },
    transcription: {
      isAvailable: async () => true,
      transcribe: () =>
        new Promise(resolve => {
          finish = resolve;
        }),
      unload: async () => {},
      abort: async () => {},
    },
    transcriptionPath: '/models/tiny.bin',
  };
  const tree = await renderComposer(supportedPort(), {
    voiceRuntime: runtime,
  });
  await act(async () => {
    voiceButton(tree.root).props.onToggle();
  });
  await act(async () => {
    voiceButton(tree.root).props.onToggle();
  });
  expect(voiceButton(tree.root).props.processing).toBe(true);
  await act(async () => {
    jest.advanceTimersByTime(VOICE_PILL_PROCESS_MS);
  });
  expect(voiceButton(tree.root).props.processing).toBe(true);
  await act(async () => {
    finish({ text: 'hello' });
  });
  expect(voiceButton(tree.root).props.processing).toBe(false);
  act(() => {
    tree.unmount();
  });
  jest.useRealTimers();
});
