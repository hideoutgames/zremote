// Accessibility assertions: roles, labels, states on the composer, session
// rows, the question panel and the model picker.

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { TextInput } from 'react-native';
import { Composer } from '../src/components/Composer';
import { QuestionPanel } from '../src/components/agentsKit/QuestionPanel';
import { HomeScreen } from '../src/screens/HomeScreen';
import { workspaceStore } from '../src/zeron/state/workspaceStore';
import {
  AppServicesContext,
  type AppServices,
} from '../src/app/runtimeContext';
import { dictationUnavailable } from '../src/zeron/native/dictation';
import { ModelPickerSheet } from '../src/components/ModelPickerSheet';
import {
  catalogStore,
  type DeviceCatalog,
} from '../src/zeron/state/catalogStore';
import type { UserInputQuestion } from '../src/zeron/protocol/types';

const services: AppServices = {
  auth: null as never,
  runtime: null,
  openSession: () => {},
  signOut: async () => {},
};

const render = async (element: React.ReactElement) => {
  let tree: TestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    tree = TestRenderer.create(
      <AppServicesContext.Provider value={services}>
        {element}
      </AppServicesContext.Provider>,
    );
  });
  return tree!;
};

const labelled = (root: TestRenderer.ReactTestInstance) =>
  root
    .findAll(n => typeof n.props.accessibilityLabel === 'string')
    .map(n => ({
      label: n.props.accessibilityLabel as string,
      role: n.props.accessibilityRole as string | undefined,
    }));

beforeEach(() => {
  workspaceStore.setState({
    devices: [
      {
        id: 'h1',
        name: 'workstation',
        platform: 'macos',
        capabilities: [],
        version: '0.2.72',
      },
    ],
    spaces: [],
    chats: [],
    sessions: {},
    presence: {},
    connection: 'connected',
    lastSyncAt: undefined,
  });
});

test('composer: input labelled, send/stop/mic/model buttons have roles', async () => {
  const tree = await render(
    <Composer
      chatId="c1"
      phase="idle"
      roomState="connected"
      harness={undefined}
      capabilities={new Set()}
      modelLabel="Agent · Default"
      onOpenModelPicker={() => {}}
      onOpenQueue={() => {}}
      dictation={dictationUnavailable}
      onSend={() => {}}
      onSteer={() => {}}
      onQueue={() => {}}
      onStop={() => {}}
      onCancel={() => {}}
      onSendAttachments={() => Promise.resolve('sent' as never)}
      onRespondInput={() => {}}
      onSendBlocked={() => {}}
      composerRef={{ current: null }}
      onLayout={() => {}}
    />,
  );
  const input = tree.root.findByType(TextInput);
  expect(input.props.accessibilityLabel).toBeTruthy();
  const labels = labelled(tree.root);
  expect(labels.some(l => l.role === 'button' && l.label === 'Send')).toBe(
    true,
  );
  expect(labels.some(l => l.label === 'Dictate' || /dict/i.test(l.label))).toBe(
    true,
  );
  expect(labels.some(l => l.label === 'Agent · Default')).toBe(true);
});

test('session row: role button, label contains title + status + host', async () => {
  workspaceStore.setState({
    chats: [
      {
        id: 'c1',
        deviceId: 'h1',
        title: 'Fix flaky test',
        archived: false,
        createdAt: Date.now(),
      },
    ],
  });
  const tree = await render(
    <HomeScreen onOpenSession={() => {}} onOpenSettings={() => {}} />,
  );
  const row = labelled(tree.root).find(
    l => l.role === 'button' && l.label.includes('Fix flaky test'),
  );
  expect(row).toBeDefined();
  expect(row!.label).toContain('workstation');
});

test('question panel: options are labelled buttons', async () => {
  const questions: UserInputQuestion[] = [
    {
      id: 'q1',
      header: 'Q',
      question: 'Pick one',
      options: ['Alpha', 'Beta'],
      multiSelect: false,
    },
  ];
  const tree = await render(
    <QuestionPanel requestId="r1" questions={questions} onSubmit={() => {}} />,
  );
  const labels = labelled(tree.root);
  expect(
    labels.filter(l => l.role === 'button' || l.role === 'checkbox').length,
  ).toBeGreaterThanOrEqual(3); // two options + submit
});

test('model picker: agent/model/effort controls are labelled', async () => {
  const catalog: DeviceCatalog = {
    harnesses: [{ id: 'claude', name: 'Claude', reasoningLevels: [] } as never],
    modelsByHarness: { claude: [] },
    loading: false,
    loadedAt: Date.now(),
  };
  catalogStore.setState({ byDevice: { h1: catalog } });
  const tree = await render(
    <ModelPickerSheet
      runtime={{} as never}
      chat={{
        id: 'c1',
        deviceId: 'h1',
        archived: false,
        createdAt: 0,
        config: { harness: 'claude', modelOptions: {} },
      }}
      phase="idle"
      hasMessages={false}
      onClose={() => {}}
    />,
  );
  const labels = labelled(tree.root);
  // Every pressable row carries a role + label.
  expect(labels.filter(l => l.role === 'button').length).toBeGreaterThan(0);
  expect(labels.some(l => l.label.includes('Claude'))).toBe(true);
});
