// Temporary test mode: a sign-in bypass for testing that populates every
// synced store with synthetic data (generic names only — no real accounts).
// Entry point: the "Open test mode" button on SignInScreen. No registry,
// relay, or runtime is created — `runtime` stays null and screens render
// from the seeded stores. Exiting (sign out) clears everything again.

import { createStore, useStore } from 'zustand';
import { authStore } from '../state/authStore';
import { workspaceStore } from '../state/workspaceStore';
import { getSessionStore, resetSessionStores } from '../state/sessionStores';
import { catalogStore } from '../state/catalogStore';
import { changeRequestStore } from '../state/changeRequestStore';
import { draftStore } from '../state/draftStore';
import { uiPrefsStore } from '../state/uiPrefs';
import type {
  Chat,
  DeviceRow,
  MessageEntry,
  QueuedMessage,
  SessionCommandEntry,
  SessionRow,
  Space,
} from '../protocol/types';
import { EngineCapability } from '../protocol/types';

interface TestModeState {
  active: boolean;
}

export const testModeStore = createStore<TestModeState>(() => ({
  active: false,
}));

export const useTestMode = (): boolean =>
  useStore(testModeStore, s => s.active);

const DEV_MACBOOK = 'dev-macbook';
const DEV_DESKTOP = 'dev-desktop';

const now = Date.now();
const min = 60_000;
const hour = 60 * min;

const deviceRow = (id: string, name: string, platform: string): DeviceRow => ({
  id,
  name,
  platform,
  lastSeenAt: now,
  createdAt: now - 30 * 24 * hour,
  version: '0.2.72',
  capabilities: Object.values(EngineCapability),
});

const devices: DeviceRow[] = [
  deviceRow(DEV_MACBOOK, 'MacBook', 'macos'),
  deviceRow(DEV_DESKTOP, 'desktop', 'linux'),
];

const spaces: Space[] = [
  {
    id: 'space-zremote',
    deviceId: DEV_MACBOOK,
    path: '~/code/zremote',
    name: 'zremote',
    gitDetected: true,
    gitCheckedAt: now - hour,
    createdAt: now - 20 * 24 * hour,
  },
  {
    id: 'space-webapp',
    deviceId: DEV_DESKTOP,
    path: '~/code/webapp',
    name: 'webapp',
    gitDetected: true,
    gitCheckedAt: now - 2 * hour,
    createdAt: now - 15 * 24 * hour,
  },
];

const chat = (patch: Partial<Chat> & Pick<Chat, 'id' | 'deviceId'>): Chat => ({
  archived: false,
  createdAt: now - 5 * 24 * hour,
  ...patch,
});

const chats: Chat[] = [
  chat({
    id: 'chat-flaky-login',
    deviceId: DEV_MACBOOK,
    spaceId: 'space-zremote',
    title: 'Fix flaky login test',
    cwd: '~/code/zremote',
    branch: 'fix/login-flake',
    checkoutId: 'checkout-login',
    config: {
      harness: 'claude-code',
      model: 'claude-opus-4',
      reasoning: 'high',
      modelOptions: {},
    },
    lastMessagePreview: 'Reproduced the flake — retry loop had a race',
    lastMessageAt: now - 3 * min,
    roomGen: 2,
  }),
  chat({
    id: 'chat-deploy-runbook',
    deviceId: DEV_DESKTOP,
    spaceId: 'space-webapp',
    title: 'Deploy runbook updates',
    cwd: '~/code/webapp',
    branch: 'docs/deploy',
    config: {
      harness: 'codex',
      model: 'gpt-5-codex',
      modelOptions: {},
    },
    lastMessagePreview: 'Which environments should the checklist cover?',
    lastMessageAt: now - 25 * min,
    roomGen: 2,
  }),
  chat({
    id: 'chat-bench',
    deviceId: DEV_MACBOOK,
    spaceId: 'space-zremote',
    title: 'Benchmark harness regression',
    cwd: '~/code/zremote',
    branch: 'main',
    config: {
      harness: 'claude-code',
      model: 'claude-sonnet-4',
      modelOptions: {},
    },
    lastMessagePreview: 'Bisect failed: build broke before the suspect range',
    lastMessageAt: now - 5 * hour,
    roomGen: 2,
  }),
  chat({
    id: 'chat-ui-pass',
    deviceId: DEV_MACBOOK,
    spaceId: 'space-zremote',
    title: 'Sidebar polish pass',
    cwd: '~/code/zremote',
    branch: 'ui/sidebar-polish',
    config: {
      harness: 'claude-code',
      model: 'claude-opus-4',
      modelOptions: {},
    },
    lastMessagePreview: 'Done — dividers now respect safe-area insets',
    lastMessageAt: now - 2 * 24 * hour,
    roomGen: 2,
  }),
  chat({
    id: 'chat-archived',
    deviceId: DEV_DESKTOP,
    spaceId: 'space-webapp',
    title: 'Old migration cleanup',
    archived: true,
    cwd: '~/code/webapp',
    branch: 'main',
    lastMessagePreview: 'Migration dropped, nothing else references it',
    lastMessageAt: now - 10 * 24 * hour,
    createdAt: now - 40 * 24 * hour,
    roomGen: 2,
  }),
];

const sessionRow = (
  chatId: string,
  deviceId: string,
  status: SessionRow['status'],
  updatedAt: number,
): SessionRow => ({
  chatId,
  deviceId,
  status,
  startedAt: now - 2 * hour,
  updatedAt,
});

const sessions: Record<string, SessionRow> = {
  'chat-flaky-login': sessionRow(
    'chat-flaky-login',
    DEV_MACBOOK,
    'working',
    now - 30_000,
  ),
  'chat-deploy-runbook': sessionRow(
    'chat-deploy-runbook',
    DEV_DESKTOP,
    'awaitingInput',
    now - 20 * min,
  ),
  'chat-bench': sessionRow(
    'chat-bench',
    DEV_MACBOOK,
    'errored',
    now - 5 * hour,
  ),
  'chat-ui-pass': sessionRow(
    'chat-ui-pass',
    DEV_MACBOOK,
    'idle',
    now - 2 * 24 * hour,
  ),
};

const msg = (
  id: string,
  role: MessageEntry['role'],
  parts: MessageEntry['parts'],
  createdAt: number,
  deviceId = DEV_MACBOOK,
  status?: MessageEntry['status'],
): MessageEntry => ({ id, role, parts, createdAt, deviceId, status });

const flakyLoginEntries: MessageEntry[] = [
  msg(
    'm-u1',
    'user',
    [
      {
        kind: 'text',
        id: 'p1',
        text: 'The login integration test flakes about 1 in 5 runs. Find the race and fix it.',
      },
    ],
    now - 2 * hour,
  ),
  msg(
    'm-a1',
    'assistant',
    [
      {
        kind: 'reasoning',
        id: 'p2',
        text: 'The test logs in, reloads, then asserts on a token that may be rotated mid-flight. Check the retry loop around refresh.',
      },
      {
        kind: 'text',
        id: 'p3',
        text: 'Reproduced locally — the retry loop reuses a stale token after refresh.',
      },
      {
        kind: 'tool',
        id: 'p4',
        call: { kind: 'exec', command: 'npm test -- login --runInBand' },
        resolved: true,
        output: 'FAIL src/auth/login.test.ts (flake repro: 3/10 runs)',
        outputBytes: 412,
      },
      {
        kind: 'tool',
        id: 'p5',
        call: {
          kind: 'todo',
          items: [
            { text: 'Reproduce the flake', done: true },
            { text: 'Find the stale-token race', done: true },
            { text: 'Patch refresh retry loop', done: false },
          ],
        },
        resolved: true,
      },
      {
        kind: 'tool',
        id: 'p6',
        call: { kind: 'editFile', path: 'src/auth/refresh.ts' },
        resolved: true,
        diffStats: [
          { path: 'src/auth/refresh.ts', additions: 14, deletions: 6 },
        ],
      },
      {
        kind: 'text',
        id: 'p7',
        text: 'Fix is in: the retry loop now re-reads the token after refresh instead of caching the pre-refresh value. Running the suite 20x to confirm.',
      },
    ],
    now - 2 * hour + 4 * min,
    DEV_MACBOOK,
    'complete',
  ),
  msg(
    'm-a2',
    'assistant',
    [
      { kind: 'reasoning', id: 'p8', text: 'Still running the 20x soak…' },
      {
        kind: 'tool',
        id: 'p9',
        call: {
          kind: 'exec',
          command: 'for i in {1..20}; do npm test -- login; done',
        },
        resolved: false,
      },
      {
        kind: 'text',
        id: 'p10',
        text: 'Soak in progress — 12/20 green so far.',
      },
    ],
    now - 8 * min,
    DEV_MACBOOK,
    'streaming',
  ),
];

const deployEntries: MessageEntry[] = [
  msg(
    'm-u2',
    'user',
    [
      {
        kind: 'text',
        id: 'q1',
        text: 'Update the deploy runbook for the new edge nodes.',
      },
    ],
    now - 3 * hour,
    DEV_DESKTOP,
  ),
  msg(
    'm-a3',
    'assistant',
    [
      {
        kind: 'text',
        id: 'q2',
        text: 'I found the runbook at docs/deploy.md. Before I rewrite it:',
      },
      {
        kind: 'input',
        id: 'q3',
        requestId: 'req-envs',
        questions: [
          {
            id: 'envs',
            header: 'Environments',
            question: 'Which environments should the checklist cover?',
            options: ['staging', 'production', 'canary'],
            multiSelect: true,
          },
          {
            id: 'rollback',
            header: 'Rollback',
            question: 'Include the rollback section?',
            options: ['Yes', 'No'],
          },
        ],
        resolved: false,
      },
    ],
    now - 25 * min,
    DEV_DESKTOP,
    'complete',
  ),
];

const benchEntries: MessageEntry[] = [
  msg(
    'm-u3',
    'user',
    [
      {
        kind: 'text',
        id: 'b1',
        text: 'Bisect the benchmark regression between v0.2.70 and v0.2.72.',
      },
    ],
    now - 6 * hour,
  ),
  msg(
    'm-a4',
    'assistant',
    [
      {
        kind: 'tool',
        id: 'b2',
        call: { kind: 'exec', command: 'git bisect start v0.2.72 v0.2.70' },
        resolved: true,
        output: 'Bisecting: 41 revisions left',
        outputBytes: 38,
      },
      {
        kind: 'error',
        id: 'b3',
        message: 'Host disconnected during bisect — relay session ended.',
      },
    ],
    now - 5 * hour,
    undefined,
    'aborted',
  ),
];

const flakyLoginCommands: SessionCommandEntry[] = [
  {
    id: 'cmd-run-1',
    kind: 'run',
    payload: {
      kind: 'run',
      messageId: 'm-u1',
      request: {
        prompt:
          'The login integration test flakes about 1 in 5 runs. Find the race and fix it.',
        modelOptions: {},
        cwd: '~/code/zremote',
        sandbox: 'danger-full-access',
        autoApprove: true,
      },
    },
    issuedBy: DEV_MACBOOK,
    issuedAt: now - 2 * hour,
    status: 'applied',
  },
];

const deployQueue: QueuedMessage[] = [
  {
    id: 'qmsg-1',
    text: 'Also add a note about the new health-check endpoint.',
    issuedBy: DEV_DESKTOP,
    issuedAt: now - 10 * min,
  },
];

export const enterTestMode = (): void => {
  const presence = {
    [DEV_MACBOOK]: now,
    // desktop was seen ~3 min ago — beyond the 45s "live" freshness window.
    [DEV_DESKTOP]: now - 3 * min,
  };

  workspaceStore.setState({
    devices,
    spaces,
    chats,
    sessions,
    presence,
    connection: 'connected',
    lastSyncAt: now,
  });

  getSessionStore('chat-flaky-login').setState({
    entries: flakyLoginEntries,
    commands: flakyLoginCommands,
    queue: [],
    meta: { contextUsage: { tokens: 81_234, window: 200_000 } },
    pendingSends: [
      {
        messageId: 'pend-1',
        text: 'Ping me when the soak finishes.',
        at: now - min,
        started: now - min,
      },
    ],
    failedSends: [],
    unsyncedCommandIds: [],
    room: 'caughtUp',
    queueActionsPending: new Set(),
    hostDeviceId: DEV_MACBOOK,
  });

  getSessionStore('chat-deploy-runbook').setState({
    entries: deployEntries,
    commands: [],
    queue: deployQueue,
    meta: { contextUsage: { tokens: 12_400, window: 128_000 } },
    pendingSends: [],
    failedSends: [
      {
        messageId: 'fail-1',
        commandId: 'cmd-fail-1',
        text: 'Bump the deploy timeout while you are in there.',
        at: now - 30 * min,
        started: now - 30 * min,
        status: 'expired',
      },
    ],
    unsyncedCommandIds: [],
    room: 'caughtUp',
    queueActionsPending: new Set(),
    hostDeviceId: DEV_DESKTOP,
  });

  getSessionStore('chat-bench').setState({
    entries: benchEntries,
    commands: [],
    queue: [],
    meta: {},
    pendingSends: [],
    failedSends: [],
    unsyncedCommandIds: [],
    room: 'disconnected',
    queueActionsPending: new Set(),
    hostDeviceId: DEV_MACBOOK,
    lastError: 'Host disconnected during bisect',
  });

  catalogStore.setState({
    byDevice: {
      [DEV_MACBOOK]: {
        harnesses: [
          {
            id: 'claude-code',
            name: 'Claude Code',
            supportsSteering: true,
            steeringMode: 'step-boundary',
            reasoningLevels: ['minimal', 'low', 'medium', 'high'],
            installed: true,
            enabled: true,
          },
          {
            id: 'codex',
            name: 'Codex',
            supportsSteering: true,
            steeringMode: 'turn-boundary',
            reasoningLevels: ['low', 'medium', 'high'],
            installed: true,
            enabled: true,
          },
        ],
        modelsByHarness: {
          'claude-code': [
            {
              id: 'claude-opus-4',
              label: 'Opus 4',
              reasoningLevels: ['minimal', 'low', 'medium', 'high'],
              options: [],
            },
            {
              id: 'claude-sonnet-4',
              label: 'Sonnet 4',
              reasoningLevels: ['low', 'medium', 'high'],
              options: [],
            },
          ],
          codex: [
            {
              id: 'gpt-5-codex',
              label: 'GPT-5 Codex',
              reasoningLevels: ['low', 'medium', 'high'],
              options: [],
            },
          ],
        },
        loading: false,
        loadedAt: now,
      },
      [DEV_DESKTOP]: {
        harnesses: [
          {
            id: 'codex',
            name: 'Codex',
            supportsSteering: false,
            installed: true,
            enabled: true,
          },
        ],
        modelsByHarness: {
          codex: [
            {
              id: 'gpt-5-codex',
              label: 'GPT-5 Codex',
              reasoningLevels: ['low', 'medium', 'high'],
              options: [],
            },
          ],
        },
        loading: false,
        loadedAt: now,
      },
    },
  });

  changeRequestStore.setState({
    byChat: {
      'chat-flaky-login': {
        checkoutId: 'checkout-login',
        deviceId: DEV_MACBOOK,
        cwd: '~/code/zremote',
        branch: 'fix/login-flake',
        changeRequest: {
          provider: 'github',
          number: 47,
          title: 'Fix flaky login test',
          url: 'https://github.com/example/zremote/pull/47',
          state: 'open',
          baseRef: 'main',
          headRef: 'fix/login-flake',
        },
        updatedAt: new Date(now - 5 * min).toISOString(),
      },
    },
    diffByChat: {
      'chat-flaky-login': {
        checkoutId: 'checkout-login',
        deviceId: DEV_MACBOOK,
        cwd: '~/code/zremote',
        patch:
          'diff --git a/src/auth/refresh.ts b/src/auth/refresh.ts\n--- a/src/auth/refresh.ts\n+++ b/src/auth/refresh.ts\n@@ -42,7 +42,9 @@ export async function refreshWithRetry(\n-  const token = await getToken();\n-  return retry(() => call(token));\n+  return retry(async () => {\n+    const token = await getToken();\n+    return call(token);\n+  });\n',
        files: [
          {
            path: 'src/auth/refresh.ts',
            status: 'modified',
            additions: 14,
            deletions: 6,
            binary: false,
          },
        ],
        additions: 14,
        deletions: 6,
        truncated: false,
        checksum: 'demo',
        updatedAt: new Date(now - 5 * min).toISOString(),
      },
    },
  });

  draftStore.setState(s => ({
    byChat: {
      ...s.byChat,
      'chat-ui-pass': {
        text: 'Follow up: check the iPad split view too',
        attachments: [],
        updatedAt: now - 24 * hour,
      },
    },
  }));

  uiPrefsStore.setState(s => ({
    ...s,
    pinnedChatIds: ['chat-flaky-login'],
    recentModels: [
      { harness: 'claude-code', model: 'claude-opus-4' },
      { harness: 'codex', model: 'gpt-5-codex' },
    ],
    composeDefaults: {
      deviceId: DEV_MACBOOK,
      spaceId: 'space-zremote',
      harness: 'claude-code',
      model: 'claude-opus-4',
      reasoning: 'high',
    },
  }));

  authStore.setState({
    status: {
      state: 'signedIn',
      user: { id: 'user-demo', email: 'user@example.com', firstName: 'User' },
      orgId: 'org-demo',
    },
  });
  testModeStore.setState({ active: true });
};

export const exitTestMode = (): void => {
  if (!testModeStore.getState().active) return;
  testModeStore.setState({ active: false });
  resetSessionStores();
  workspaceStore.setState({
    devices: [],
    spaces: [],
    chats: [],
    sessions: {},
    presence: {},
    connection: 'disconnected',
  });
  catalogStore.setState({ byDevice: {} });
  changeRequestStore.setState({ byChat: {}, diffByChat: {} });
  uiPrefsStore.setState(s => ({ ...s, pinnedChatIds: [] }));
  authStore.setState({ status: { state: 'signedOut' } });
};
