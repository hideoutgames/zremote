// Demo mode fixtures — fictional hosts, spaces, chats and transcripts. All
// paths/content are invented for the simulated edge; nothing here is real.

import {
  encodeHlc,
  type FieldValue,
  type Row,
} from '../zeron/protocol/registryCore';
import type {
  AgentAccountsSnapshot,
  CheckoutDiff,
  GitHistoryCommit,
  HarnessDescriptor,
  Model,
  QueuedMessage,
  RepoRef,
  WorkspaceEntry,
} from '../zeron/protocol/types';
import { EngineCapability } from '../zeron/protocol/types';

export const DEMO_ORG = 'demo-org';
export const DEMO_USER = 'demo-user';
export const DEMO_PHONE = 'demo-phone';
export const HOST_LIVE = 'demo-mac';
export const HOST_DARK = 'demo-studio';

export const CHAT_WORKING = 'c-working';
export const CHAT_INPUT = 'c-input';
export const CHAT_LONG = 'c-long';
export const CHAT_TOOLS = 'c-tools';
export const CHAT_OFFLINE = 'c-offline';
export const CHAT_ERRORED = 'c-errored';
export const CHAT_ARCHIVED = 'c-archived';

const BASE_MS = 1_760_000_000_000;
const HLC = encodeHlc(BASE_MS, 0, 'demo-edge');

const row = (
  kind: string,
  id: string,
  fields: Record<string, FieldValue>,
  seq: number,
): Row => ({
  kind,
  id,
  seq,
  deleted: false,
  fields,
  clocks: Object.fromEntries(Object.keys(fields).map(k => [k, HLC])),
});

const CAPS = Object.values(EngineCapability) as string[];

export const demoDevices = {
  live: {
    id: HOST_LIVE,
    name: "Torea's MacBook Pro",
    platform: 'macos',
    version: '0.2.72',
  },
  dark: {
    id: HOST_DARK,
    name: 'Studio Desktop',
    platform: 'windows',
    version: '0.2.72',
  },
};

export const SPACE_ZREMOTE = 's-zremote';
export const SPACE_ZERON = 's-zeron';
export const SPACE_BABYLON = 's-babylon';

export const demoPaths = {
  zremote: '/demo/code/zremote',
  zeron: '/demo/code/zeron',
  babylon: '/demo/code/babylon-slate',
};

export const demoRegistryRows = (nowMs: number): Row[] => [
  row(
    'devices',
    HOST_LIVE,
    {
      id: HOST_LIVE,
      name: demoDevices.live.name,
      platform: 'macos',
      lastSeenAt: nowMs,
      createdAt: BASE_MS - 90 * 86_400_000,
      version: '0.2.72',
      capabilities: CAPS,
    },
    1,
  ),
  row(
    'devices',
    HOST_DARK,
    {
      id: HOST_DARK,
      name: demoDevices.dark.name,
      platform: 'windows',
      lastSeenAt: nowMs - 3 * 3_600_000,
      createdAt: BASE_MS - 60 * 86_400_000,
      version: '0.2.72',
      capabilities: CAPS,
    },
    2,
  ),
  row(
    'spaces',
    SPACE_ZREMOTE,
    {
      id: SPACE_ZREMOTE,
      deviceId: HOST_LIVE,
      path: demoPaths.zremote,
      name: 'zremote',
      gitDetected: true,
      createdAt: BASE_MS - 30 * 86_400_000,
    },
    3,
  ),
  row(
    'spaces',
    SPACE_ZERON,
    {
      id: SPACE_ZERON,
      deviceId: HOST_LIVE,
      path: demoPaths.zeron,
      name: 'zeron',
      gitDetected: true,
      createdAt: BASE_MS - 28 * 86_400_000,
    },
    4,
  ),
  row(
    'spaces',
    SPACE_BABYLON,
    {
      id: SPACE_BABYLON,
      deviceId: HOST_DARK,
      path: demoPaths.babylon,
      name: 'babylon-slate',
      gitDetected: true,
      createdAt: BASE_MS - 20 * 86_400_000,
    },
    5,
  ),
  row(
    'chats',
    CHAT_WORKING,
    {
      id: CHAT_WORKING,
      deviceId: HOST_LIVE,
      spaceId: SPACE_ZREMOTE,
      title: 'Ship demo mode',
      archived: false,
      cwd: demoPaths.zremote,
      branch: 'demo/replay',
      config: { harness: 'claude', model: 'sonnet', modelOptions: {} },
      lastMessagePreview: 'Streaming a simulated reply…',
      lastMessageAt: nowMs - 10_000,
      createdAt: BASE_MS - 2 * 86_400_000,
      roomGen: 2,
    },
    6,
  ),
  row(
    'chats',
    CHAT_INPUT,
    {
      id: CHAT_INPUT,
      deviceId: HOST_LIVE,
      spaceId: SPACE_ZREMOTE,
      title: 'Pick a caching strategy',
      archived: false,
      cwd: demoPaths.zremote,
      branch: 'main',
      config: { harness: 'claude', model: 'opus', modelOptions: {} },
      lastMessagePreview: 'Which approach should I take?',
      lastMessageAt: nowMs - 3_600_000,
      createdAt: BASE_MS - 3 * 86_400_000,
      roomGen: 2,
    },
    7,
  ),
  row(
    'chats',
    CHAT_LONG,
    {
      id: CHAT_LONG,
      deviceId: HOST_LIVE,
      spaceId: SPACE_ZERON,
      title: 'Refactor relay reconnect',
      archived: false,
      cwd: demoPaths.zeron,
      branch: 'main',
      config: { harness: 'codex', model: 'gpt-5', modelOptions: {} },
      lastMessagePreview: 'That covers the backoff rewrite.',
      lastMessageAt: nowMs - 26 * 3_600_000,
      createdAt: BASE_MS - 5 * 86_400_000,
      roomGen: 2,
    },
    8,
  ),
  row(
    'chats',
    CHAT_TOOLS,
    {
      id: CHAT_TOOLS,
      deviceId: HOST_LIVE,
      spaceId: SPACE_ZERON,
      title: 'Sketch glass header',
      archived: false,
      cwd: demoPaths.zeron,
      branch: 'main',
      config: { harness: 'claude', model: 'sonnet', modelOptions: {} },
      lastMessagePreview: 'The Explorer found three call sites.',
      lastMessageAt: nowMs - 50 * 3_600_000,
      createdAt: BASE_MS - 6 * 86_400_000,
      roomGen: 2,
    },
    9,
  ),
  row(
    'chats',
    CHAT_OFFLINE,
    {
      id: CHAT_OFFLINE,
      deviceId: HOST_DARK,
      spaceId: SPACE_BABYLON,
      title: 'Babylon slate notes',
      archived: false,
      cwd: demoPaths.babylon,
      branch: 'main',
      config: { harness: 'codex', model: 'gpt-5-codex', modelOptions: {} },
      lastMessagePreview: 'Host is dark — reopen later.',
      lastMessageAt: nowMs - 4 * 86_400_000,
      createdAt: BASE_MS - 9 * 86_400_000,
      roomGen: 2,
    },
    10,
  ),
  row(
    'chats',
    CHAT_ERRORED,
    {
      id: CHAT_ERRORED,
      deviceId: HOST_LIVE,
      spaceId: SPACE_ZERON,
      title: 'Investigate sync gap',
      archived: false,
      cwd: demoPaths.zeron,
      branch: 'fix/reconnect-backoff',
      config: { harness: 'claude', model: 'sonnet', modelOptions: {} },
      lastMessagePreview: 'The run failed: simulated engine error.',
      lastMessageAt: nowMs - 8 * 3_600_000,
      createdAt: BASE_MS - 7 * 86_400_000,
      roomGen: 2,
    },
    11,
  ),
  row(
    'chats',
    CHAT_ARCHIVED,
    {
      id: CHAT_ARCHIVED,
      deviceId: HOST_LIVE,
      spaceId: SPACE_ZREMOTE,
      title: 'Old experiment',
      archived: true,
      cwd: demoPaths.zremote,
      branch: 'main',
      config: { harness: 'mock', modelOptions: {} },
      lastMessagePreview: 'Archived months ago.',
      lastMessageAt: nowMs - 80 * 86_400_000,
      createdAt: BASE_MS - 80 * 86_400_000,
      roomGen: 2,
    },
    12,
  ),
  row(
    'sessions',
    CHAT_WORKING,
    {
      chatId: CHAT_WORKING,
      deviceId: HOST_LIVE,
      status: 'working',
      startedAt: nowMs - 12_000,
      updatedAt: nowMs - 5_000,
    },
    13,
  ),
  row(
    'sessions',
    CHAT_INPUT,
    {
      chatId: CHAT_INPUT,
      deviceId: HOST_LIVE,
      status: 'awaitingInput',
      startedAt: nowMs - 3_600_000,
      updatedAt: nowMs - 3_000_000,
    },
    14,
  ),
  row(
    'sessions',
    CHAT_LONG,
    {
      chatId: CHAT_LONG,
      deviceId: HOST_LIVE,
      status: 'idle',
      updatedAt: nowMs - 26 * 3_600_000,
    },
    15,
  ),
  row(
    'sessions',
    CHAT_TOOLS,
    {
      chatId: CHAT_TOOLS,
      deviceId: HOST_LIVE,
      status: 'idle',
      updatedAt: nowMs - 50 * 3_600_000,
    },
    16,
  ),
  row(
    'sessions',
    CHAT_OFFLINE,
    {
      chatId: CHAT_OFFLINE,
      deviceId: HOST_DARK,
      status: 'idle',
      updatedAt: nowMs - 4 * 86_400_000,
    },
    17,
  ),
  row(
    'sessions',
    CHAT_ERRORED,
    {
      chatId: CHAT_ERRORED,
      deviceId: HOST_LIVE,
      status: 'errored',
      startedAt: nowMs - 9 * 3_600_000,
      updatedAt: nowMs - 8 * 3_600_000,
    },
    18,
  ),
];

// ── Transcripts (wire form — what `entryFrom` decodes; reasoning parts carry
// the body on `reasoning`, never `text`) ────────────────────────────────────

let partSeq = 0;
const pid = () => `p-${(partSeq += 1)}`;

const userEntry = (
  id: string,
  text: string,
  createdAt: number,
): Record<string, unknown> => ({
  id,
  role: 'user',
  parts: [{ kind: 'text', id: pid(), text }],
  createdAt,
  deviceId: DEMO_PHONE,
});

const assistantEntry = (
  id: string,
  parts: Record<string, unknown>[],
  createdAt: number,
  status = 'complete',
): Record<string, unknown> => ({
  id,
  role: 'assistant',
  parts,
  createdAt,
  deviceId: HOST_LIVE,
  status,
});

const textPart = (text: string): Record<string, unknown> => ({
  kind: 'text',
  id: pid(),
  text,
});

const workingTranscript = (nowMs: number): Record<string, unknown>[] => [
  userEntry('w-u1', 'Add a demo mode that simulates the edge.', nowMs - 12_000),
  assistantEntry(
    'w-a1',
    [
      {
        kind: 'reasoning',
        id: 'w-r1',
        reasoning:
          'The runtime dials two rooms, so the fake belongs behind the existing wsFactory seam.',
      },
      {
        kind: 'text',
        id: 'w-t1',
        text: "I'm wiring a `DemoEdge` that speaks the registry and device-room protocols in-process.\n\nStill checking the RPC surface",
      },
    ],
    nowMs - 11_000,
    'streaming',
  ),
];

const inputTranscript = (nowMs: number): Record<string, unknown>[] => [
  userEntry(
    'i-u1',
    'Should cached transcripts live in memory or on disk?',
    nowMs - 3_600_000,
  ),
  assistantEntry(
    'i-a1',
    [
      {
        kind: 'reasoning',
        id: 'i-r1',
        reasoning:
          'Disk keeps scrollback across reloads but complicates demo reset.',
      },
      textPart(
        'Both work for demo purposes. Memory is simpler; disk survives a reload. Before I pick, one question:',
      ),
      {
        kind: 'input',
        id: 'i-in1',
        requestId: 'i-in1',
        questions: [
          {
            id: 'q1',
            header: 'Storage',
            question: 'Where should the simulated transcript live?',
            options: [
              'In-memory only (resets on reload)',
              'Persisted to the demo disk',
              'Let the host decide per chat',
            ],
          },
        ],
        resolved: false,
      },
    ],
    nowMs - 3_500_000,
    'streaming',
  ),
];

const longTranscript = (nowMs: number): Record<string, unknown>[] => {
  const entries: Record<string, unknown>[] = [];
  for (let i = 0; i < 18; i += 1) {
    entries.push(
      userEntry(
        `l-u${i}`,
        `Step ${i + 1}: adjust the backoff ${
          i % 2 === 0 ? 'cap' : 'base'
        } and re-check.`,
        nowMs - (40 - i * 2) * 60_000,
      ),
      assistantEntry(
        `l-a${i}`,
        [
          textPart(
            `Done with step ${i + 1}. The reconnect loop now waits ${
              250 * (i + 1)
            }ms before redial attempt ${
              i + 1
            }.\n\n- probe still answers in-band\n- backoff resets after a stable join`,
          ),
        ],
        nowMs - (40 - i * 2) * 60_000 + 45_000,
      ),
    );
  }
  entries.push(
    userEntry(
      'l-img',
      'Here is the layout sketch I mentioned.',
      nowMs - 5_400_000,
    ),
    assistantEntry(
      'l-img-reply',
      [
        {
          kind: 'tool',
          id: 'l-todo',
          call: {
            kind: 'todo',
            items: [
              { text: 'Map reconnect states', done: true },
              { text: 'Rewrite backoff table', done: true },
              { text: 'Add probe coverage', done: false },
            ],
          },
          isError: false,
          resolved: true,
        },
        textPart(
          'Got it — the plan above is tracked. Three items remain before the refactor lands.',
        ),
      ],
      nowMs - 5_300_000,
    ),
  );
  // The image chip lives on the user entry's parts.
  (entries[entries.length - 2].parts as Record<string, unknown>[]).push({
    kind: 'image',
    id: 'l-img-p',
    path: '/demo/uploads/layout-sketch.png',
    name: 'layout-sketch.png',
    mimeType: 'image/png',
  });
  return entries;
};

const toolsTranscript = (nowMs: number): Record<string, unknown>[] => [
  userEntry('t-u1', 'Where is the header styled?', nowMs - 50 * 3_600_000),
  assistantEntry(
    't-a1',
    [
      {
        kind: 'tool',
        id: 't-sub',
        call: {
          kind: 'unknown',
          name: 'Agent: Explore composer UI',
          input: { subagent_type: 'Explore' },
        },
        isError: false,
        resolved: true,
        subagentStatus: 'done',
      },
      {
        kind: 'tool',
        id: 't-sub-run',
        call: {
          kind: 'unknown',
          name: 'Agent: Trace header styles',
          input: { subagent_type: 'Explore' },
        },
        resolved: false,
        subagentStatus: 'running',
      },
      {
        kind: 'tool',
        id: 't-read',
        call: { kind: 'readFile', path: '/demo/src/missing.ts' },
        isError: true,
        resolved: true,
        output: 'ENOENT: no such file (simulated)',
      },
      textPart(
        'The Explorer found three call sites; one read failed on a moved file — shown above as an errored tool.',
      ),
    ],
    nowMs - 50 * 3_600_000 + 60_000,
  ),
];

const offlineTranscript = (nowMs: number): Record<string, unknown>[] => [
  userEntry('o-u1', 'Summarize the slate notes.', nowMs - 4 * 86_400_000),
  assistantEntry(
    'o-a1',
    [
      textPart(
        'Notes synced from the studio machine. Reopen when it is back online.',
      ),
    ],
    nowMs - 4 * 86_400_000 + 120_000,
  ),
];

const erroredTranscript = (nowMs: number): Record<string, unknown>[] => [
  userEntry('e-u1', 'Replay the sync gap logs.', nowMs - 9 * 3_600_000),
  assistantEntry(
    'e-a1',
    [
      textPart('Starting the replay…'),
      {
        kind: 'error',
        id: 'e-err',
        message: 'Simulated engine error: transcript desync at seq 41.',
      },
    ],
    nowMs - 8 * 3_600_000,
    'aborted',
  ),
];

const archivedTranscript = (nowMs: number): Record<string, unknown>[] => [
  userEntry(
    'a-u1',
    'Try the old experiment once more.',
    nowMs - 80 * 86_400_000,
  ),
  assistantEntry(
    'a-a1',
    [textPart('It worked. Archiving this chat now.')],
    nowMs - 80 * 86_400_000 + 60_000,
  ),
];

export const demoTranscripts = (
  nowMs: number,
): Record<string, Record<string, unknown>[]> => ({
  [CHAT_WORKING]: workingTranscript(nowMs),
  [CHAT_INPUT]: inputTranscript(nowMs),
  [CHAT_LONG]: longTranscript(nowMs),
  [CHAT_TOOLS]: toolsTranscript(nowMs),
  [CHAT_OFFLINE]: offlineTranscript(nowMs),
  [CHAT_ERRORED]: erroredTranscript(nowMs),
  [CHAT_ARCHIVED]: archivedTranscript(nowMs),
});

export const demoQueues = (nowMs: number): Record<string, QueuedMessage[]> => ({
  [CHAT_INPUT]: [
    {
      id: 'q-1',
      text: 'Also compare against the relay backlog.',
      issuedBy: DEMO_PHONE,
      issuedAt: nowMs - 2_900_000,
    },
  ],
});

// ── Catalog / repo / misc fixtures ─────────────────────────────────────────

export const demoHarnesses = (): HarnessDescriptor[] => [
  {
    id: 'claude',
    name: 'Claude Code',
    supportsSteering: true,
    steeringMode: 'turn-boundary',
    reasoningLevels: ['low', 'medium', 'high'],
    installed: true,
    enabled: true,
  },
  {
    id: 'codex',
    name: 'Codex',
    supportsSteering: true,
    steeringMode: 'turn-boundary',
    reasoningLevels: ['minimal', 'low', 'medium', 'high', 'xhigh'],
    installed: true,
    enabled: true,
  },
  { id: 'mock', name: 'Mock', installed: true, enabled: true },
];

export const demoModels = (harness?: string): Model[] => {
  switch (harness) {
    case 'codex':
      return [
        {
          id: 'gpt-5',
          label: 'GPT-5',
          reasoningLevels: ['minimal', 'low', 'medium', 'high', 'xhigh'],
          options: [],
        },
        {
          id: 'gpt-5-codex',
          label: 'GPT-5 Codex',
          reasoningLevels: ['minimal', 'low', 'medium', 'high', 'xhigh'],
          options: [],
        },
      ];
    case 'mock':
      return [
        {
          id: 'mock-1',
          label: 'Mock model',
          reasoningLevels: ['low'],
          options: [],
        },
      ];
    case 'claude':
    default:
      return [
        {
          id: 'sonnet',
          label: 'Claude Sonnet',
          reasoningLevels: ['low', 'medium', 'high'],
          options: [
            {
              id: 'fast',
              label: 'Fast mode',
              choices: [
                { id: 'off', label: 'Off' },
                { id: 'on', label: 'On' },
              ],
              defaultChoice: 'off',
            },
          ],
        },
        {
          id: 'opus',
          label: 'Claude Opus',
          reasoningLevels: ['low', 'medium', 'high'],
          options: [],
        },
      ];
  }
};

export const demoRefs = (): RepoRef[] => [
  { name: 'main', current: true },
  { name: 'demo/replay', current: false },
  { name: 'fix/reconnect-backoff', current: false },
  {
    name: 'wt/feature-branch',
    current: false,
    worktreePath: '/demo/zremote-wt',
  },
];

export const demoFolders = (
  path?: string,
): {
  path: string;
  entries: { name: string; isDir: boolean; isRepo: boolean }[];
  truncated: boolean;
} => {
  if (
    path === undefined ||
    path === '' ||
    path === '/demo' ||
    path === '/demo/code'
  ) {
    return {
      path: '/demo/code',
      entries: [
        { name: 'zremote', isDir: true, isRepo: true },
        { name: 'zeron', isDir: true, isRepo: true },
        { name: 'babylon-slate', isDir: true, isRepo: true },
        { name: 'notes.txt', isDir: false, isRepo: false },
      ],
      truncated: false,
    };
  }
  return { path, entries: [], truncated: false };
};

export const demoWorkspaceListing = (directory: string): WorkspaceEntry[] => {
  const mk = (
    path: string,
    name: string,
    kind: WorkspaceEntry['kind'],
    size?: number,
  ): WorkspaceEntry => ({
    path,
    name,
    kind,
    ...(size !== undefined ? { size } : {}),
    modifiedAt: '2026-09-01T10:00:00Z',
    ignored: false,
    readOnly: false,
  });
  if (directory === '' || directory === '.' || directory === '/') {
    return [
      mk('src', 'src', 'directory'),
      mk('docs', 'docs', 'directory'),
      mk('README.md', 'README.md', 'file', 1200),
      mk('package.json', 'package.json', 'file', 900),
    ];
  }
  if (directory === 'src') {
    return [
      mk('src/demo', 'demo', 'directory'),
      mk('src/main.ts', 'main.ts', 'file', 400),
      mk('src/util.ts', 'util.ts', 'file', 800),
    ];
  }
  if (directory === 'src/demo') {
    return [
      mk('src/demo/demoEdge.ts', 'demoEdge.ts', 'file', 2400),
      mk('src/demo/fixtures.ts', 'fixtures.ts', 'file', 1800),
    ];
  }
  if (directory === 'docs') {
    return [mk('docs/DEMO.md', 'DEMO.md', 'file', 600)];
  }
  return [];
};

export const demoFiles: Record<string, string> = {
  'README.md':
    '# zremote (demo)\n\nFictional workspace served by the demo edge.\n',
  'package.json': '{\n  "name": "zremote-demo",\n  "private": true\n}\n',
  'src/main.ts': "export const main = () => 'demo';\n",
  'src/util.ts': 'export const noop = () => {};\n',
  'src/demo/demoEdge.ts': '// simulated edge — see demo mode docs\n',
  'src/demo/fixtures.ts': '// fictional fixture data\n',
  'docs/DEMO.md': '# Demo\n\nNothing here leaves the device.\n',
};

export const demoDiff = (
  checkoutId: string,
  deviceId: string,
  cwd: string,
): CheckoutDiff => ({
  checkoutId,
  deviceId,
  cwd,
  patch:
    'diff --git a/src/demo/demoEdge.ts b/src/demo/demoEdge.ts\n' +
    'new file mode 100644\n' +
    '--- /dev/null\n' +
    '+++ b/src/demo/demoEdge.ts\n' +
    '@@ -0,0 +1,3 @@\n' +
    '+// simulated edge\n' +
    '+export class DemoEdge {}\n' +
    '+// end\n',
  files: [
    {
      path: 'src/demo/demoEdge.ts',
      status: 'added',
      additions: 3,
      deletions: 0,
      binary: false,
    },
    {
      path: 'src/util.ts',
      status: 'modified',
      additions: 4,
      deletions: 1,
      binary: false,
    },
  ],
  additions: 7,
  deletions: 1,
  truncated: false,
  checksum: 'demo-checksum-1',
  updatedAt: '2026-09-19T10:00:00Z',
});

export const demoCommits = (): GitHistoryCommit[] => {
  const mk = (
    sha: string,
    subject: string,
    authoredAt: string,
    refs: { kind: string; label: string }[] = [],
  ): GitHistoryCommit => ({
    sha,
    parentShas: [],
    subject,
    authorName: 'Demo Author',
    authorEmail: 'demo@example.test',
    authoredAt,
    refs,
  });
  return [
    mk('aaa001', 'Add demo mode simulated edge', '2026-09-19T09:00:00Z', [
      { kind: 'head', label: 'main' },
    ]),
    mk('aaa002', 'Wire registry presence beats', '2026-09-18T15:00:00Z'),
    mk('aaa003', 'Simulate transcript deltas', '2026-09-18T11:00:00Z'),
    mk('aaa004', 'Fixture: two hosts, three spaces', '2026-09-17T18:00:00Z'),
    mk('aaa005', 'Echo terminal for demo sessions', '2026-09-17T09:00:00Z', [
      { kind: 'branch', label: 'demo/replay' },
    ]),
    mk('aaa006', 'Initial demo scaffolding', '2026-09-16T12:00:00Z'),
  ];
};

export const demoAccounts = (): AgentAccountsSnapshot => ({
  accounts: [
    {
      id: 'demo-acct-claude',
      harness: 'claude',
      email: 'demo@example.test',
      planLabel: 'Demo plan',
      active: true,
      usageWindows: [{ label: 'Session', usedFraction: 0.18 }],
      displayName: 'Demo User',
      authKind: 'oauth',
      switchable: true,
      savedAt: 1_760_000_000_000,
    },
  ],
  warnings: [],
});
