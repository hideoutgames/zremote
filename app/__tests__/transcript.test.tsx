// Render tests for the transcript components using the real mock-harness
// transcript captured in .e2e/report.md (step5 entries + step7 input part).

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Text, View } from 'react-native';
import {
  UserMessage,
  USER_BUBBLE_MAX_WIDTH,
  USER_BUBBLE_TEXT_END_PAD,
} from '../src/components/transcript/UserMessage';
import { AssistantMessage } from '../src/components/transcript/AssistantMessage';
import { BUBBLE_BLUR_INTENSITY } from '../src/components/transcript/FrostedBubble';
import { InputCard } from '../src/components/transcript/InputCard';
import { messageCopyContent } from '../src/components/transcript/MessageCopyMenu';
import { PlanBadge } from '../src/components/PlanBadge';
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

const childList = (children: unknown): unknown[] =>
  children == null ? [] : Array.isArray(children) ? children : [children];

const badgeNestedInPrompt = (
  root: TestRenderer.ReactTestInstance,
  prompt: string,
): boolean => {
  const badge = root.findByType(PlanBadge);
  let n: TestRenderer.ReactTestInstance | null = badge.parent;
  while (n != null) {
    if (n.type === Text) {
      const parts = childList(n.props.children);
      if (parts.some(p => p === prompt)) return true;
    }
    n = n.parent;
  }
  return false;
};

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

test('UserMessage strips the build prefix and shows a Build badge', async () => {
  const entry: MessageEntry = {
    ...userEntry,
    parts: [
      {
        kind: 'text',
        id: 't0',
        text: '/build IMPLEMENT THE PLAN: Implement the plan.',
      },
    ],
  };
  let tree: TestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    tree = TestRenderer.create(<UserMessage entry={entry} />);
  });
  const texts = textOf(tree!.root);
  expect(texts).toContain('Build');
  expect(texts).toContain('Implement the plan.');
  expect(texts.some(s => typeof s === 'string' && s.includes('/build'))).toBe(
    false,
  );
});

test('UserMessage inlines the Plan badge inside the prompt Text', async () => {
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
  expect(badgeNestedInPrompt(tree!.root, 'ship it')).toBe(true);
  const badge = tree!.root.findByType(PlanBadge);
  expect(badge.props.variant).toBe('inline');
});

test('UserMessage inlines the Build badge inside the prompt Text', async () => {
  const entry: MessageEntry = {
    ...userEntry,
    parts: [
      {
        kind: 'text',
        id: 't0',
        text: '/build IMPLEMENT THE PLAN: Implement the plan.',
      },
    ],
  };
  let tree: TestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    tree = TestRenderer.create(<UserMessage entry={entry} />);
  });
  expect(badgeNestedInPrompt(tree!.root, 'Implement the plan.')).toBe(true);
});

test('UserMessage keeps row padding when a Plan badge is present', async () => {
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
  const row = tree!.root.findAllByType(View).find(n => {
    const style = Array.isArray(n.props.style)
      ? n.props.style.flat()
      : [n.props.style];
    return style.some(s => s?.paddingVertical === 12);
  });
  expect(row).toBeDefined();
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
        onOpenReasoning={() => {}}
        onOpenPlan={() => {}}
        onOpenFileDiff={() => {}}
      />,
    );
  });
  const texts = textOf(tree!.root);
  expect(texts).toContain('Resize composer');
  expect(texts).toContain('Changes');
  expect(texts).toContain('Composer.tsx');
});

test('AssistantMessage shows a Plan card for name-only createPlan', async () => {
  const entry: MessageEntry = {
    ...assistantEntry,
    parts: [
      {
        kind: 'tool',
        id: 'p1',
        call: { kind: 'unknown', name: 'createPlan' },
        resolved: true,
      },
    ],
  };
  let tree: TestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    tree = TestRenderer.create(
      <AssistantMessage
        entry={entry}
        onOpenReasoning={() => {}}
        onOpenPlan={() => {}}
      />,
    );
  });
  const texts = textOf(tree!.root);
  expect(texts).toContain('Plan');
  expect(texts.some(s => s === 'Tool' || s === 'createPlan')).toBe(false);
  expect(tree!.root.findAllByType(PlanBadge).length).toBe(1);
});

test('AssistantMessage groups the tool parts into one rail', async () => {
  let tree: TestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    tree = TestRenderer.create(
      <AssistantMessage entry={assistantEntry} onOpenReasoning={() => {}} />,
    );
  });
  const texts = textOf(tree!.root);
  // the two exec calls collapse into the group summary
  expect(texts).toContain('Ran 2 commands');
  expect(
    tree!.root.findAll(n => n.props.testID === 'tool-group-toggle')[0]?.props
      .accessibilityState.expanded,
  ).toBe(false);
});

test('streaming trailing tool group auto-opens', async () => {
  const entry: MessageEntry = {
    ...assistantEntry,
    status: 'streaming',
    parts: assistantEntry.parts.filter(p => p.kind === 'tool'),
  };
  let tree: TestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    tree = TestRenderer.create(
      <AssistantMessage entry={entry} onOpenReasoning={() => {}} />,
    );
  });
  expect(
    tree!.root.findAll(n => n.props.testID === 'tool-group-toggle')[0]?.props
      .accessibilityState.expanded,
  ).toBe(true);
  expect(textOf(tree!.root)).toContain('cargo test --workspace');
});

test('expanding a tool chip shows invocation and output', async () => {
  const entry: MessageEntry = {
    ...assistantEntry,
    parts: [
      {
        kind: 'tool',
        id: 't1',
        call: { kind: 'exec', command: 'cargo test --workspace' },
        isError: false,
        resolved: true,
        output: 'test result: ok. 3 passed',
      },
    ],
  };
  let tree: TestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    tree = TestRenderer.create(
      <AssistantMessage entry={entry} onOpenReasoning={() => {}} />,
    );
  });
  await act(async () => {
    tree!.root.findByProps({ testID: 'tool-group-toggle' }).props.onPress();
  });
  expect(textOf(tree!.root)).toContain('cargo test --workspace');
  await act(async () => {
    tree!.root.findByProps({ testID: 'tool-chip' }).props.onPress();
  });
  expect(textOf(tree!.root)).toContain('test result: ok. 3 passed');
});

test('expanded edit chip shows diff stats', async () => {
  const entry: MessageEntry = {
    ...assistantEntry,
    parts: [
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
      <AssistantMessage entry={entry} onOpenReasoning={() => {}} />,
    );
  });
  await act(async () => {
    tree!.root.findByProps({ testID: 'tool-group-toggle' }).props.onPress();
  });
  await act(async () => {
    tree!.root.findByProps({ testID: 'tool-chip' }).props.onPress();
  });
  const texts = textOf(tree!.root);
  expect(texts).toContain('+12');
  expect(texts).toContain('−3');
});

test('Show full output fetch upgrades the chip body', async () => {
  const entry: MessageEntry = {
    ...assistantEntry,
    parts: [
      {
        kind: 'tool',
        id: 't1',
        call: { kind: 'exec', command: 'cargo test --workspace' },
        isError: false,
        resolved: true,
        output: 'ok',
        outputRef: 'chat/t1',
        outputBytes: 32,
      },
    ],
  };
  const seen: string[] = [];
  let tree: TestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    tree = TestRenderer.create(
      <AssistantMessage
        entry={entry}
        onOpenReasoning={() => {}}
        onFetchBlob={async partId => {
          seen.push(partId);
          return 'full cargo output\nline 2';
        }}
      />,
    );
  });
  await act(async () => {
    tree!.root.findByProps({ testID: 'tool-group-toggle' }).props.onPress();
  });
  await act(async () => {
    tree!.root.findByProps({ testID: 'tool-chip' }).props.onPress();
  });
  expect(textOf(tree!.root)).toContain('Show full output (32 B)');
  await act(async () => {
    await tree!.root.findByProps({ testID: 'tool-blob-link' }).props.onPress();
  });
  expect(seen).toEqual(['t1']);
  expect(textOf(tree!.root)).toContain('full cargo output');
  expect(textOf(tree!.root)).toContain('line 2');
});

test('waiting assistant does not render an in-bubble working spinner', async () => {
  const entry: MessageEntry = {
    ...assistantEntry,
    status: 'streaming',
    parts: [{ kind: 'text', id: 't0', text: '' }],
  };
  let tree: TestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    tree = TestRenderer.create(
      <AssistantMessage entry={entry} onOpenReasoning={() => {}} />,
    );
  });
  expect(
    tree!.root.findAll(n => n.props.testID === 'working-spinner').length,
  ).toBe(0);
  expect(
    tree!.root.findAll(n => n.props.testID === 'working-wait').length,
  ).toBe(0);
  expect(
    tree!.root.findAll(n => n.props.testID === 'working-status-strip').length,
  ).toBe(0);
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

test('InputCard shows the question, the chosen labels, and Answered', async () => {
  let tree: TestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    tree = TestRenderer.create(
      <InputCard
        part={{ ...inputPart, resolved: true }}
        answers={[
          {
            questionId: 'q-sync',
            labels: ['Event-driven fold with coalesced commits'],
          },
        ]}
      />,
    );
  });
  const texts = textOf(tree!.root);
  expect(texts).toContain('Which sync strategy should the rewrite use?');
  expect(texts).toContain('Event-driven fold with coalesced commits');
  expect(texts).toContain('Answered');
  const question = tree!.root.findAll(
    n =>
      typeof n.props.children === 'string' &&
      n.props.children === 'Which sync strategy should the rewrite use?',
  )[0];
  expect(question.props.numberOfLines).toBeUndefined();
});

test('messageCopyContent is a zeego Content element', () => {
  const el = messageCopyContent('hello from the phone');
  expect(el.type).toBe(ContextMenu.Content);
});

const enteringViews = (root: TestRenderer.ReactTestInstance) =>
  root.findAll(n => n.props.entering != null);

test('UserMessage skips the send entering animation by default', async () => {
  let tree: TestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    tree = TestRenderer.create(<UserMessage entry={userEntry} />);
  });
  expect(enteringViews(tree!.root)).toHaveLength(0);
});

test('UserMessage plays send entering when animateEnter is set', async () => {
  const onEntered = jest.fn();
  let tree: TestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    tree = TestRenderer.create(
      <UserMessage entry={userEntry} animateEnter onEntered={onEntered} />,
    );
  });
  expect(enteringViews(tree!.root).length).toBeGreaterThan(0);
  expect(onEntered).toHaveBeenCalledWith(userEntry.id);
});

const flatStyle = (style: unknown): Record<string, unknown>[] => {
  if (style == null) return [];
  if (Array.isArray(style)) return style.flatMap(flatStyle);
  if (typeof style === 'object') return [style as Record<string, unknown>];
  return [];
};

test('UserMessage shows the sent text inside a bubble sized to content', async () => {
  let tree: TestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    tree = TestRenderer.create(<UserMessage entry={userEntry} />);
  });
  expect(textOf(tree!.root)).toContain('hello from the phone');
  const row = tree!.root.findByProps({ testID: 'user-message' });
  const cap = tree!.root.findByProps({ testID: 'user-bubble-cap' });
  const bubble = tree!.root.findByProps({ testID: 'user-bubble' });
  expect(flatStyle(row.props.style).some(s => s.width === '100%')).toBe(true);
  expect(row.findByProps({ testID: 'user-bubble-cap' })).toBeTruthy();
  expect(
    flatStyle(cap.props.style).some(s => s.maxWidth === USER_BUBBLE_MAX_WIDTH),
  ).toBe(true);
  expect(flatStyle(bubble.props.style).some(s => s.maxWidth === '82%')).toBe(
    false,
  );
  expect(flatStyle(bubble.props.style).some(s => s.width === '100%')).toBe(
    false,
  );
  expect(
    bubble.findAll(n => n.props.intensity != null)[0].props.intensity,
  ).toBe(BUBBLE_BLUR_INTENSITY);
});

test('UserMessage keeps the full prompt in the bubble Text', async () => {
  const entry: MessageEntry = {
    ...userEntry,
    parts: [{ kind: 'text', id: 't0', text: 'Test your skills' }],
  };
  let tree: TestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    tree = TestRenderer.create(<UserMessage entry={entry} />);
  });
  const prompt = tree!.root.findAllByType(Text).find(n => {
    const c = n.props.children;
    return c === 'Test your skills';
  });
  expect(prompt).toBeDefined();
  expect(prompt!.props.numberOfLines).toBeUndefined();
  expect(flatStyle(prompt!.props.style).some(s => s.flexShrink === 0)).toBe(
    false,
  );
});

test('UserMessage text keeps trailing optical pad so glyphs are not clipped', async () => {
  let tree: TestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    tree = TestRenderer.create(<UserMessage entry={userEntry} />);
  });
  const prompt = tree!.root.findAllByType(Text).find(n => {
    const c = n.props.children;
    return c === 'hello from the phone';
  });
  expect(prompt).toBeDefined();
  const style = Array.isArray(prompt!.props.style)
    ? prompt!.props.style.flat()
    : [prompt!.props.style];
  expect(style.some(s => s?.paddingEnd === USER_BUBBLE_TEXT_END_PAD)).toBe(
    true,
  );
});

test('AssistantMessage wraps text in a chat bubble', async () => {
  let tree: TestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    tree = TestRenderer.create(
      <AssistantMessage entry={assistantEntry} onOpenReasoning={() => {}} />,
    );
  });
  const bubble = tree!.root.findByProps({ testID: 'assistant-bubble' });
  const style = Array.isArray(bubble.props.style)
    ? bubble.props.style.flat()
    : [bubble.props.style];
  expect(style.some(s => s?.maxWidth === '100%')).toBe(true);
  expect(style.some(s => s?.maxWidth === '82%' || s?.maxWidth === '88%')).toBe(
    false,
  );
  expect(
    bubble.findAll(n => n.props.intensity != null)[0].props.intensity,
  ).toBe(BUBBLE_BLUR_INTENSITY);
});

test('UserMessage never ellipsizes a short prompt', async () => {
  const entry: MessageEntry = {
    ...userEntry,
    parts: [{ kind: 'text', id: 't0', text: 'Test' }],
  };
  let tree: TestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    tree = TestRenderer.create(<UserMessage entry={entry} />);
  });
  expect(textOf(tree!.root)).toContain('Test');
  expect(textOf(tree!.root).some(s => s === 'T…' || s === 'T...')).toBe(false);
  expect(
    tree!.root.findAll(n => n.props.testID === 'user-bubble-fold'),
  ).toHaveLength(0);
});

test('UserMessage folds after 1000 characters', async () => {
  const long = 'x'.repeat(1001);
  const entry: MessageEntry = {
    ...userEntry,
    parts: [{ kind: 'text', id: 't0', text: long }],
  };
  let tree: TestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    tree = TestRenderer.create(<UserMessage entry={entry} />);
  });
  expect(textOf(tree!.root)).toContain(`${'x'.repeat(1000)}…`);
  const fold = tree!.root.findByProps({ testID: 'user-bubble-fold' });
  await act(async () => {
    fold.props.onPress();
  });
  expect(textOf(tree!.root)).toContain(long);
});

test('AssistantMessage puts tools, changes, and working inside the bubble', async () => {
  const now = Date.now();
  let tree: TestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    tree = TestRenderer.create(
      <AssistantMessage
        entry={assistantEntry}
        onOpenReasoning={() => {}}
        onOpenFileDiff={() => {}}
        showWorking
        workingChatId="c1"
        workingStartedAt={now}
      />,
    );
  });
  const bubble = tree!.root.findByProps({ testID: 'assistant-bubble' });
  expect(
    bubble.findAll(n => n.props.testID === 'working-status-strip').length,
  ).toBeGreaterThan(0);
  expect(textOf(tree!.root)).toContain('Ran 2 commands');
});
