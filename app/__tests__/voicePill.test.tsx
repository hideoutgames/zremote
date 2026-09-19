// VoicePill idle / processing UI, plus Composer stop cooldown (2s spinner).

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { ActivityIndicator } from 'react-native';
import { Composer } from '../src/components/Composer';
import { Icon } from '../src/components/Icon';
import { VoicePill } from '../src/components/VoicePill';
import { VOICE_PILL_PROCESS_MS } from '../src/components/voicePillMath';
import { resetDrafts } from '../src/zeron/state/draftStore';
import { resetSessionStores } from '../src/zeron/state/sessionStores';
import type { DictationPort } from '../src/zeron/native/dictation';

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

const renderComposer = async (dictation: DictationPort) => {
  let tree: TestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    tree = TestRenderer.create(
      <Composer {...composerProps} dictation={dictation} />,
    );
  });
  return tree!;
};

const voiceButton = (root: TestRenderer.ReactTestInstance) =>
  root.findByType(VoicePill);

beforeEach(() => {
  resetDrafts();
});

afterEach(() => {
  resetSessionStores();
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
  expect(dictation.stop).toHaveBeenCalledTimes(1);
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
  expect(dictation.stop).not.toHaveBeenCalled();
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
