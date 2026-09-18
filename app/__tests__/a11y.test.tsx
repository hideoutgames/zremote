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
import {
  getSessionStore,
  resetSessionStores,
} from '../src/zeron/state/sessionStores';
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
  resetSessionStores();
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
      modelShortLabel="Default"
      modelProvider="generic"
      models={[]}
      agents={[]}
      harnessLocked={false}
      effortLevels={[]}
      onPickModel={() => {}}
      onPickAgent={() => {}}
      onPickEffort={() => {}}
      onOpenMore={() => {}}
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
  expect(labels.some(l => l.label === 'Default')).toBe(true);
});

test('composer: Devin shows separate model and effort buttons', async () => {
  const tree = await render(
    <Composer
      chatId="c1"
      phase="idle"
      roomState="connected"
      harness={{
        id: 'devin',
        name: 'Devin',
        supportsSteering: true,
        steeringMode: 'turn-boundary',
      }}
      capabilities={new Set()}
      modelShortLabel="Devin 2"
      modelProvider="devin"
      models={[{ id: 'devin-2', label: 'Devin 2', provider: 'devin' }]}
      selectedModelId="devin-2"
      agents={[{ id: 'devin', name: 'Devin' }]}
      selectedAgentId="devin"
      harnessLocked={false}
      effortLevels={['low', 'medium', 'high']}
      effortValue="high"
      onPickModel={() => {}}
      onPickAgent={() => {}}
      onPickEffort={() => {}}
      onOpenMore={() => {}}
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
  const labels = labelled(tree.root);
  expect(labels.some(l => l.role === 'button' && l.label === 'Devin 2')).toBe(
    true,
  );
  expect(
    labels.some(l => l.role === 'button' && l.label === 'Effort, High'),
  ).toBe(true);
});

test('composer: queued messages show Queue: N above the glass', async () => {
  getSessionStore('c1').setState({
    queue: [
      { id: 'q1', text: 'one', issuedBy: 'u', issuedAt: 1 },
      { id: 'q2', text: 'two', issuedBy: 'u', issuedAt: 2 },
    ],
  });
  const onOpenQueue = jest.fn();
  const tree = await render(
    <Composer
      chatId="c1"
      phase="working"
      roomState="connected"
      harness={undefined}
      capabilities={new Set()}
      modelShortLabel="Default"
      modelProvider="generic"
      models={[]}
      agents={[]}
      harnessLocked={false}
      effortLevels={[]}
      onPickModel={() => {}}
      onPickAgent={() => {}}
      onPickEffort={() => {}}
      onOpenMore={() => {}}
      onOpenQueue={onOpenQueue}
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
  const chip = tree.root.findByProps({ accessibilityLabel: 'Queue: 2' });
  expect(chip.props.accessibilityRole).toBe('button');
  await act(async () => {
    chip.props.onPress();
  });
  expect(onOpenQueue).toHaveBeenCalledTimes(1);
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

test('model picker: model rows are labelled', async () => {
  const catalog: DeviceCatalog = {
    harnesses: [{ id: 'claude', name: 'Claude', reasoningLevels: [] } as never],
    modelsByHarness: {
      claude: [
        {
          id: 'opus',
          label: 'Opus',
          reasoningLevels: [],
          options: [],
        },
      ],
    },
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
        config: { harness: 'claude', model: 'opus', modelOptions: {} },
      }}
      phase="idle"
      hasMessages={false}
      onClose={() => {}}
    />,
  );
  const labels = labelled(tree.root);
  expect(labels.filter(l => l.role === 'button').length).toBeGreaterThan(0);
  expect(labels.some(l => l.label.includes('Opus'))).toBe(true);
});
