// Render tests for the transcript components using the real mock-harness
// transcript captured in .e2e/report.md (step5 entries + step7 input part).

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import { UserMessage } from '../src/components/transcript/UserMessage';
import { AssistantMessage } from '../src/components/transcript/AssistantMessage';
import { InputCard } from '../src/components/transcript/InputCard';
import { messageCopyContent } from '../src/components/transcript/MessageCopyMenu';
import * as ContextMenu from 'zeego/context-menu';
import type { MessageEntry, MessagePart } from '../src/zeron/protocol/types';

const userEntry: MessageEntry = {
  id: 'd94e7465-6f95-453e-88f7-ec637394b54d',
  role: 'user',
  parts: [{ kind: 'text', id: 't0', text: 'hello from the phone' }],
  createdAt: 1789679755519,
  deviceId: 'd1',
  status: 'complete',
};

const assistantEntry: MessageEntry = {
  id: 'c3506014-a476-4dd0-b9ef-c35c481f575f',
  role: 'assistant',
  parts: [
    {
      kind: 'text',
      id: 't0',
      text: '## Streaming pipeline\n\nEvery turn flows through the same path:',
    },
    {
      kind: 'tool',
      id: 'mock-tool-1',
      call: { command: 'cargo test --workspace', kind: 'exec' },
      isError: false,
      resolved: true,
    },
    {
      kind: 'tool',
      id: 'mock-tool-2',
      call: { command: 'git log -5 --oneline', kind: 'exec' },
      isError: false,
      resolved: true,
    },
    {
      kind: 'text',
      id: 't3',
      text: 'Synced to every device through the session room.',
    },
  ],
  createdAt: 1789679756455,
  deviceId: 'd1',
  status: 'complete',
};

const inputPart: Extract<MessagePart, { kind: 'input' }> = {
  kind: 'input',
  id: '58a5048c-63b9-4106-8c14-291ba2581dab',
  requestId: '58a5048c-63b9-4106-8c14-291ba2581dab',
  resolved: false,
  questions: [
    {
      id: 'q-sync',
      header: 'Question',
      question: 'Which sync strategy should the rewrite use?',
      options: [
        'Poll the doc host every 120ms',
        'Event-driven fold with coalesced commits',
      ],
      multiSelect: false,
    },
  ],
};

const textOf = (root: TestRenderer.ReactTestInstance): string[] =>
  root.findAllByType(Text).flatMap(n => {
    const c = n.props.children;
    return Array.isArray(c) ? c : [c];
  });

test('UserMessage strips the plan prefix and shows a Plan badge', async () => {
  const entry: MessageEntry = {
    ...userEntry,
    parts: [
      {
        kind: 'text',
        id: 't0',
        text: '/plan PLEASE CREATE A PLAN BEFORE IMPLEMENTING: ship it',
      },
    ],
  };
  let tree: TestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    tree = TestRenderer.create(<UserMessage entry={entry} />);
  });
  const texts = textOf(tree!.root);
  expect(texts).toContain('Plan');
  expect(texts).toContain('ship it');
  expect(texts.some(s => typeof s === 'string' && s.includes('/plan'))).toBe(
    false,
  );
});

test('AssistantMessage shows a plan card and turn changes', async () => {
  const entry: MessageEntry = {
    ...assistantEntry,
    parts: [
      {
        kind: 'tool',
        id: 'p1',
        call: {
          kind: 'unknown',
          name: 'createPlan',
          input: { name: 'Resize composer', plan: '# Resize\n\nDrag.' },
        },
        resolved: true,
      },
      {
        kind: 'tool',
        id: 'e1',
        call: { kind: 'editFile', path: 'app/src/components/Composer.tsx' },
        resolved: true,
        diffStats: [
          {
            path: 'app/src/components/Composer.tsx',
            additions: 12,
            deletions: 3,
          },
        ],
      },
    ],
  };
  let tree: TestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    tree = TestRenderer.create(
      <AssistantMessage
        entry={entry}
        phase="idle"
        onOpenReasoning={() => {}}
        onOpenPlan={() => {}}
        onOpenFileDiff={() => {}}
      />,
    );
  });
  const texts = textOf(tree!.root);
  expect(texts).toContain('Resize composer');
  expect(texts).not.toContain('Changes 1');
  expect(texts).toContain('Composer.tsx');
});

test('AssistantMessage groups the tool parts into one rail', async () => {
  let tree: TestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    tree = TestRenderer.create(
      <AssistantMessage
        entry={assistantEntry}
        phase="idle"
        onOpenReasoning={() => {}}
      />,
    );
  });
  const texts = textOf(tree!.root);
  // the two exec calls collapse into the group summary
  expect(texts).toContain('Ran 2 commands');
});

test('InputCard summarizes an open question', async () => {
  let tree: TestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    tree = TestRenderer.create(<InputCard part={inputPart} />);
  });
  expect(textOf(tree!.root)).toContain(
    'Which sync strategy should the rewrite use?',
  );
});

test('InputCard shows Answered once resolved', async () => {
  let tree: TestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    tree = TestRenderer.create(
      <InputCard part={{ ...inputPart, resolved: true }} />,
    );
  });
  expect(textOf(tree!.root)).toContain('Answered');
});

test('messageCopyContent is a zeego Content element', () => {
  const el = messageCopyContent('hello from the phone');
  expect(el.type).toBe(ContextMenu.Content);
});
