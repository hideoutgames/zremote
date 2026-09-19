// Accessibility assertions: roles, labels, states on the composer, session
// rows, the question panel and the model picker.

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Dimensions, TextInput, StyleSheet } from 'react-native';
import { Composer } from '../src/components/Composer';
import { ComposerChromeRow } from '../src/components/ComposerChromeRow';
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
import { resetDrafts, stageAttachment } from '../src/zeron/state/draftStore';
import {
  getSessionStore,
  resetSessionStores,
} from '../src/zeron/state/sessionStores';
import type { PrBadgeModel } from '../src/components/prBadge';
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
  resetDrafts();
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
  resetSessionStores();
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
      fastSupported={false}
      fastEnabled={false}
      onOpenEffort={() => {}}
      onSelectFast={() => {}}
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
  expect(labels.some(l => l.label === 'Fast mode')).toBe(false);
  expect(
    mounted.root.findAll(n => n.props.testID === 'context-usage-chip'),
  ).toHaveLength(0);
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
  dictation: dictationUnavailable,
  onSend: () => {},
  onSteer: () => {},
  onQueue: () => {},
  onStop: () => {},
  onCancel: () => {},
  onSendAttachments: () => Promise.resolve('sent' as never),
  onRespondInput: () => {},
  onSendBlocked: () => {},
};

test('fast mode chip is labelled when the harness supports it', async () => {
  const mounted = await render(
    <Composer {...composerProps} fastSupported fastEnabled />,
  );
  const labels = labelled(mounted.root);
  expect(labels.some(l => l.role === 'button' && l.label === 'Fast mode')).toBe(
    true,
  );
});

test('context usage chip appears when the session meta has tokens', async () => {
  getSessionStore('c1').setState({
    meta: { contextUsage: { tokens: 32_000, window: 200_000 } },
  });
  const mounted = await render(<Composer {...composerProps} />);
  const chip = mounted.root.findByProps({ testID: 'context-usage-chip' });
  expect(chip.props.accessibilityRole).toBe('button');
  expect(chip.props.accessibilityLabel).toMatch(/Context usage/i);
  await act(async () => {
    chip.props.onPress();
  });
  expect(
    mounted.root.findAll(n => n.props.testID === 'TrueSheet').length,
  ).toBeGreaterThan(0);
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
      fastSupported={false}
      fastEnabled={false}
      onOpenEffort={() => {}}
      onSelectFast={() => {}}
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
    mounted.root.findAll(n => n.props.testID === 'composer-surround-blur'),
  ).toHaveLength(0);
  const checkout = mounted.root.findAll(
    n => n.props.testID === 'compose-checkout' && typeof n.type === 'string',
  );
  expect(checkout).toHaveLength(1);
  expect(checkout[0].props.keyboardShouldPersistTaps).toBe('handled');
  expect(checkout[0].props.nestedScrollEnabled).toBe(true);
});

test('compact session composer keeps the surround blur; compose never does', async () => {
  const spy = jest.spyOn(Dimensions, 'get').mockReturnValue({
    width: 390,
    height: 844,
    scale: 3,
    fontScale: 1,
  });
  try {
    const session = await render(<Composer {...composerProps} />);
    expect(
      session.root.findAll(
        n =>
          n.props.testID === 'composer-surround-blur' &&
          typeof n.type === 'string',
      ),
    ).toHaveLength(1);
    act(() => {
      session.unmount();
    });
    tree = undefined;
    const compose = await render(
      <Composer {...composerProps} mode="compose" />,
    );
    expect(
      compose.root.findAll(n => n.props.testID === 'composer-surround-blur'),
    ).toHaveLength(0);
  } finally {
    spy.mockRestore();
  }
});

test('composer: Fast mode chip is a separate labelled button', async () => {
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
      fastSupported
      fastEnabled={false}
      onOpenEffort={() => {}}
      onSelectFast={() => {}}
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
  expect(labels.some(l => l.role === 'button' && l.label === 'Fast mode')).toBe(
    true,
  );
  expect(labels.some(l => l.role === 'button' && l.label === 'High')).toBe(
    true,
  );
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

test('model picker: search, provider groups, effort, and fast are labelled', async () => {
  const catalog: DeviceCatalog = {
    harnesses: [
      {
        id: 'claude-code',
        name: 'Claude',
        reasoningLevels: ['low', 'high'],
      } as never,
      { id: 'codex', name: 'Codex', reasoningLevels: [] } as never,
    ],
    modelsByHarness: {
      'claude-code': [
        {
          id: 'sonnet',
          label: 'Sonnet',
          reasoningLevels: ['low', 'high'],
          options: [
            {
              id: 'fastMode',
              label: 'Fast',
              choices: [
                { id: 'on', label: 'On' },
                { id: 'off', label: 'Off' },
              ],
              defaultChoice: 'off',
            },
          ],
        },
      ],
      codex: [
        {
          id: 'gpt',
          label: 'GPT',
          reasoningLevels: [],
          options: [],
        },
      ],
    },
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
        config: {
          harness: 'claude-code',
          model: 'sonnet',
          reasoning: 'high',
          modelOptions: {},
        },
      }}
      phase="idle"
      onClose={() => {}}
      lockHarness={false}
    />,
  );
  const labels = labelled(mounted.root);
  expect(labels.filter(l => l.role === 'button').length).toBeGreaterThan(0);
  expect(labels.some(l => l.label === 'Close')).toBe(true);
  expect(labels.some(l => l.label === 'Done')).toBe(true);
  expect(mounted.root.findAll(n => n.props.children === 'Done')).toEqual([]);
  expect(labels.some(l => l.label === 'Search')).toBe(true);
  expect(labels.some(l => l.label === 'Sonnet')).toBe(true);
  expect(labels.some(l => l.label === 'GPT')).toBe(true);
  expect(labels.some(l => l.label === 'High')).toBe(true);
  expect(labels.some(l => l.label === 'Fast mode')).toBe(true);
  expect(labels.some(l => l.label.includes('Claude'))).toBe(true);
  expect(labels.some(l => l.label.includes('Codex'))).toBe(true);
  expect(mounted.root.findAll(n => n.props.children === 'Active')).toEqual([]);
  expect(mounted.root.findAll(n => n.props.children === 'More')).toEqual([]);
  expect(mounted.root.findAll(n => n.props.children === 'Sandbox')).toEqual([]);
  expect(
    mounted.root.findAll(n => n.props.children === 'Auto-approve'),
  ).toEqual([]);
  expect(
    mounted.root.findAll(n => n.props.children === 'Model').length,
  ).toBeGreaterThan(0);
  const selected = mounted.root.findAll(
    n =>
      n.props.accessibilityLabel === 'Sonnet' &&
      n.props.accessibilityState?.selected === true,
  );
  expect(selected.length).toBeGreaterThan(0);
  expect(StyleSheet.flatten(selected[0].props.style).flex).toBe(1);
  const effortChip = mounted.root.findAll(
    n =>
      n.props.accessibilityLabel === 'High' &&
      n.props.accessibilityRole === 'button',
  )[0];
  expect(StyleSheet.flatten(effortChip.parent?.props.style).gap).toBe(20);
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

test('queued pill is a labelled button', async () => {
  const mounted = await render(
    <ComposerChromeRow
      queueCount={2}
      onOpenQueue={() => {}}
      pr={undefined}
      onOpenPr={() => {}}
    />,
  );
  const labels = labelled(mounted.root);
  expect(labels.some(l => l.role === 'button' && l.label === '2 Queued')).toBe(
    true,
  );
  expect(mounted.root.findAll(n => n.props.testID === 'pr-pill')).toHaveLength(
    0,
  );
});

test('PR pill is labelled only when a thread PR is supplied', async () => {
  const pr: PrBadgeModel = {
    tone: 'open',
    label: 'viewPr',
    showCounts: false,
    additions: 0,
    deletions: 0,
    fileCount: 0,
    title: 'Composer chrome',
    state: 'open',
    url: 'https://github.com/acme/app/pull/7',
    number: 7,
    baseRef: 'main',
    headRef: 'feat',
  };
  const hidden = await render(
    <ComposerChromeRow
      queueCount={0}
      onOpenQueue={() => {}}
      pr={undefined}
      onOpenPr={() => {}}
    />,
  );
  expect(hidden.root.findAll(n => n.props.testID === 'pr-pill')).toHaveLength(
    0,
  );

  const shown = await render(
    <ComposerChromeRow
      queueCount={0}
      onOpenQueue={() => {}}
      pr={pr}
      onOpenPr={() => {}}
    />,
  );
  const labels = labelled(shown.root);
  expect(
    labels.some(l => l.role === 'button' && l.label === 'View pull request'),
  ).toBe(true);
  expect(
    shown.root.findAll(
      n =>
        n.props.testID === 'pr-pill' && n.props.accessibilityRole === 'button',
    ).length,
  ).toBeGreaterThan(0);
});

test('queue rows have no fill or card chrome', async () => {
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
  const row = mounted.root.findAll(n => n.props.testID === 'queue-row')[0];
  expect(row).toBeDefined();
  const flat = StyleSheet.flatten(row!.props.style);
  expect(flat.backgroundColor).toBe('transparent');
  expect(flat.borderWidth === undefined || flat.borderWidth === 0).toBe(true);
});

test('composer file tiles are square preview buttons', async () => {
  resetDrafts();
  stageAttachment('c1', {
    kind: 'file',
    name: 'notes.json',
    mimeType: 'application/json',
    size: 12,
    localUri: 'file:///notes.json',
  });
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
      fastSupported={false}
      fastEnabled={false}
      onOpenEffort={() => {}}
      onSelectFast={() => {}}
      dictation={dictationUnavailable}
      onSend={() => {}}
      onSteer={() => {}}
      onQueue={() => {}}
      onStop={() => {}}
      onCancel={() => {}}
      onSendAttachments={() => Promise.resolve('sent' as never)}
      onRespondInput={() => {}}
      onSendBlocked={() => {}}
    />,
  );
  const labels = labelled(mounted.root);
  expect(
    labels.some(l => l.role === 'button' && l.label === 'Preview notes.json'),
  ).toBe(true);
  expect(
    labels.some(l => l.role === 'button' && l.label === 'Remove notes.json'),
  ).toBe(true);
  expect(
    mounted.root.findAll(n => n.props.testID === 'attachment-strip').length,
  ).toBeGreaterThan(0);
});
