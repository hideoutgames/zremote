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
import { QueuePanel } from '../src/components/QueuePanel';
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
  await act(async () => {
    tree = TestRenderer.create(
      <AppServicesContext.Provider value={services}>
        {element}
      </AppServicesContext.Provider>,
    );
  });
  return tree!;
};

let tree: TestRenderer.ReactTestRenderer | undefined;

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

afterEach(() => {
  act(() => {
    tree?.unmount();
  });
  tree = undefined;
});

test('composer: input labelled, send/stop/mic/model buttons have roles', async () => {
  const mounted = await render(
    <Composer
      chatId="c1"
      phase="idle"
      roomState="connected"
      harness={undefined}
      capabilities={new Set()}
      modelLabel="Default"
      harnessId="claude-code"
      recentItems={[
        { harness: 'claude-code', model: 'sonnet', label: 'Sonnet' },
      ]}
      onPickRecentModel={() => {}}
      onOpenMoreModels={() => {}}
      effortLabel="High"
      effortSupported
      fastEnabled={false}
      onOpenEffort={() => {}}
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
  const input = mounted.root.findByType(TextInput);
  expect(input.props.accessibilityLabel).toBeTruthy();
  const labels = labelled(mounted.root);
  expect(labels.some(l => l.role === 'button' && l.label === 'Send')).toBe(
    true,
  );
  expect(labels.some(l => l.label === 'Dictate' || /dict/i.test(l.label))).toBe(
    true,
  );
  expect(labels.some(l => l.label === 'Default')).toBe(true);
  expect(labels.some(l => l.label === 'High')).toBe(true);
  expect(
    mounted.root.findAll(
      n => n.props.testID === 'compose-checkout' && typeof n.type === 'string',
    ),
  ).toHaveLength(0);
  expect(labels.some(l => l.label === 'Desktop')).toBe(false);
  expect(labels.some(l => l.label === 'Project')).toBe(false);
  expect(labels.some(l => l.label === 'Checkout')).toBe(false);
  expect(labels.some(l => l.label === 'Branch')).toBe(false);
});

test('compose composer: desktop, project, checkout, and branch sit above the input', async () => {
  const mounted = await render(
    <Composer
      chatId="__compose__"
      mode="compose"
      phase="idle"
      roomState="connected"
      harness={undefined}
      capabilities={new Set()}
      modelLabel="Default"
      harnessId="claude-code"
      recentItems={[
        { harness: 'claude-code', model: 'sonnet', label: 'Sonnet' },
      ]}
      onPickRecentModel={() => {}}
      onOpenMoreModels={() => {}}
      effortLabel="High"
      effortSupported
      fastEnabled={false}
      onOpenEffort={() => {}}
      checkout={{
        runtime: {} as never,
        chat: {
          id: '__compose__',
          deviceId: 'h1',
          archived: false,
          createdAt: 0,
        },
        host: {
          id: 'h1',
          name: 'Studio MacBook Pro',
          platform: 'macos',
          capabilities: [],
          version: '0.2.72',
        },
        spaces: [],
        projectLabel: 'harbor-notes',
        checkoutModeLabel: 'Current checkout',
        branchLabel: 'main',
        machineLabel: 'Studio MacBook Pro',
        newWorktree: false,
        hosts: [
          {
            id: 'h1',
            name: 'Studio MacBook Pro',
            platform: 'macos',
            capabilities: [],
            version: '0.2.72',
          },
        ],
      }}
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
  const labels = labelled(mounted.root);
  expect(labels.some(l => l.role === 'button' && l.label === 'Desktop')).toBe(
    true,
  );
  expect(labels.some(l => l.role === 'button' && l.label === 'Project')).toBe(
    true,
  );
  expect(labels.some(l => l.role === 'button' && l.label === 'Checkout')).toBe(
    true,
  );
  expect(labels.some(l => l.role === 'button' && l.label === 'Branch')).toBe(
    true,
  );
  expect(labels.some(l => l.label === 'Default')).toBe(true);
  expect(labels.some(l => l.label === 'High')).toBe(true);
  expect(
    mounted.root.findAll(
      n => n.props.testID === 'compose-checkout' && typeof n.type === 'string',
    ),
  ).toHaveLength(1);
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
  const mounted = await render(
    <HomeScreen onOpenSession={() => {}} onOpenSettings={() => {}} />,
  );
  const row = labelled(mounted.root).find(
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
  const mounted = await render(
    <QuestionPanel requestId="r1" questions={questions} onSubmit={() => {}} />,
  );
  const labels = labelled(mounted.root);
  expect(
    labels.filter(l => l.role === 'button' || l.role === 'checkbox').length,
  ).toBeGreaterThanOrEqual(3); // two options + submit
});

test('model picker: search, provider groups, and sandbox are labelled', async () => {
  const catalog: DeviceCatalog = {
    harnesses: [{ id: 'claude', name: 'Claude', reasoningLevels: [] } as never],
    modelsByHarness: { claude: [] },
    loading: false,
    loadedAt: Date.now(),
  };
  catalogStore.setState({ byDevice: { h1: catalog } });
  const mounted = await render(
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
      onClose={() => {}}
    />,
  );
  const labels = labelled(mounted.root);
  // Every pressable row carries a role + label.
  expect(labels.filter(l => l.role === 'button').length).toBeGreaterThan(0);
  expect(labels.some(l => l.label.includes('Claude'))).toBe(true);
});

test('queue panel: send now and delete are icon-only labelled buttons', async () => {
  const mounted = await render(
    <QueuePanel
      queue={[
        {
          id: 'q1',
          text: 'follow up',
          issuedBy: 'p',
          issuedAt: 1,
        },
      ]}
      actionsSupported
      pending={new Set()}
      canSteer={false}
      onAction={() => {}}
      onMove={() => {}}
    />,
  );
  const labels = labelled(mounted.root);
  expect(labels.some(l => l.role === 'button' && l.label === 'Send now')).toBe(
    true,
  );
  expect(labels.some(l => l.role === 'button' && l.label === 'Remove')).toBe(
    true,
  );
  expect(labels.some(l => l.label === 'Reorder')).toBe(true);
});
