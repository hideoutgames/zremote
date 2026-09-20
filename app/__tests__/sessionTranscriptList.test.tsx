// Open-scroll: the transcript jumps to the tail once per openKey, then
// stays put while later messages append (follow is the list's job).

import React, { useRef } from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { FlatList, Text, View, type LayoutChangeEvent } from 'react-native';
import {
  SessionTranscriptList,
  RAIL_RIGHT,
  type SessionTranscriptListHandle,
} from '../src/components/SessionTranscriptList';
import type { MessageEntry } from '../src/zeron/protocol/types';
import {
  setComposerExtraHeightLive,
  uiPrefsStore,
} from '../src/zeron/state/uiPrefs';
import { flavourSeed, flavourWord } from '../src/components/workingMotion';

const keyboardMock = jest.requireMock('@legendapp/list/keyboard') as {
  __scrollMessageToEnd: jest.Mock;
  __onComposerLayout: jest.Mock;
  __scrollToIndex: jest.Mock;
  __scrollToOffset: jest.Mock;
};
const scrollMessageToEnd = keyboardMock.__scrollMessageToEnd;
const reportComposerInset = keyboardMock.__onComposerLayout;
const scrollToIndex = keyboardMock.__scrollToIndex;
const scrollToOffset = keyboardMock.__scrollToOffset;

const FOLLOW = { on: { dataChange: true, itemLayout: true } };

const entry = (id: string): MessageEntry => ({
  id,
  role: 'user',
  parts: [{ kind: 'text', id: `t-${id}`, text: id }],
  createdAt: 1,
  deviceId: 'd1',
  status: 'complete',
});

const layoutEvent = (height: number): LayoutChangeEvent =>
  ({
    nativeEvent: { layout: { x: 0, y: 0, width: 390, height } },
  } as LayoutChangeEvent);

function lastReportedHeight(): number {
  const last = reportComposerInset.mock.calls.at(-1)?.[0] as
    | LayoutChangeEvent
    | undefined;
  return last?.nativeEvent.layout.height ?? -1;
}

function listProps(tree: TestRenderer.ReactTestRenderer) {
  return tree.root.findByType(FlatList).props;
}

function Harness({
  entries,
  openKey,
  working = false,
  startedAt = 1,
  windowWidth = 390,
  contentMaxWidth,
}: {
  entries: MessageEntry[];
  openKey: string;
  working?: boolean;
  startedAt?: number;
  windowWidth?: number;
  contentMaxWidth?: number;
}) {
  const composerRef = useRef<View>(null);
  return (
    <SessionTranscriptList
      openKey={openKey}
      entries={entries}
      renderEntry={({ item }: { item: MessageEntry }) => <Text>{item.id}</Text>}
      composerRef={composerRef}
      contentMaxWidth={contentMaxWidth}
      windowWidth={windowWidth}
      windowHeight={844}
      insetsTop={47}
      insetsBottom={34}
      onComposerHeight={() => {}}
      onShowScrollDown={() => {}}
      working={working}
      chatId="c1"
      startedAt={startedAt}
    />
  );
}

function overflowList(tree: TestRenderer.ReactTestRenderer) {
  tree.root.findByProps({ testID: 'session-transcript' }).props.onLayout({
    nativeEvent: { layout: { x: 0, y: 0, width: 390, height: 844 } },
  });
  listProps(tree).onContentSizeChange(390, 2000);
}

beforeEach(() => {
  scrollMessageToEnd.mockClear();
  reportComposerInset.mockClear();
  scrollToIndex.mockClear();
  scrollToOffset.mockClear();
  uiPrefsStore.setState({ composerExtraHeight: 0 });
});

test('scrolls to the bottom once when entries are present on mount', async () => {
  let tree: TestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    tree = TestRenderer.create(
      <Harness entries={[entry('m1')]} openKey="c1:1" />,
    );
  });
  expect(scrollMessageToEnd).toHaveBeenCalledTimes(1);
  expect(scrollMessageToEnd).toHaveBeenCalledWith({
    animated: false,
    closeKeyboard: false,
  });
  expect(listProps(tree!).maintainScrollAtEnd).toEqual(FOLLOW);
  await act(async () => {
    tree!.unmount();
  });
});

test('scrolls once when entries arrive after an empty open', async () => {
  let tree: TestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    tree = TestRenderer.create(<Harness entries={[]} openKey="c1:1" />);
  });
  expect(scrollMessageToEnd).not.toHaveBeenCalled();

  await act(async () => {
    tree!.update(<Harness entries={[entry('m1')]} openKey="c1:1" />);
  });
  expect(scrollMessageToEnd).toHaveBeenCalledTimes(1);

  await act(async () => {
    tree!.update(
      <Harness entries={[entry('m1'), entry('m2')]} openKey="c1:1" />,
    );
  });
  expect(scrollMessageToEnd).toHaveBeenCalledTimes(1);

  await act(async () => {
    tree!.unmount();
  });
});

test('scrolls again when openKey changes', async () => {
  let tree: TestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    tree = TestRenderer.create(
      <Harness entries={[entry('m1')]} openKey="c1:1" />,
    );
  });
  expect(scrollMessageToEnd).toHaveBeenCalledTimes(1);

  await act(async () => {
    tree!.update(<Harness entries={[entry('m1')]} openKey="c1:2" />);
  });
  expect(scrollMessageToEnd).toHaveBeenCalledTimes(2);

  await act(async () => {
    tree!.unmount();
  });
});

test('appends a working status row only while working', async () => {
  let tree: TestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    tree = TestRenderer.create(
      <Harness entries={[entry('m1')]} openKey="c1:1" />,
    );
  });
  expect(
    tree!.root.findAll(n => n.props.testID === 'working-status-strip'),
  ).toHaveLength(0);

  await act(async () => {
    tree!.update(
      <Harness
        entries={[entry('m1')]}
        openKey="c1:1"
        working
        startedAt={Date.now()}
      />,
    );
  });
  expect(
    tree!.root.findAll(n => n.props.testID === 'working-status-strip').length,
  ).toBeGreaterThan(0);
  expect(
    tree!.root.findAll(n => n.props.testID === 'working-spinner').length,
  ).toBeGreaterThan(0);
  const flavour = `${flavourWord(flavourSeed('c1'), 0)}…`;
  const labels = tree!.root.findAllByType(Text).flatMap(n => {
    const c = n.props.children;
    return Array.isArray(c) ? c : [c];
  });
  expect(labels).toContain(flavour);
  expect(labels).toContain('m1');
  const ids = listProps(tree!).data.map(
    (row: { kind: string; entry?: MessageEntry }) =>
      row.kind === 'working' ? 'working' : row.entry?.id,
  );
  expect(ids[ids.length - 1]).toBe('working');

  await act(async () => {
    tree!.update(<Harness entries={[entry('m1')]} openKey="c1:1" />);
  });
  expect(
    tree!.root.findAll(n => n.props.testID === 'working-status-strip'),
  ).toHaveLength(0);

  await act(async () => {
    tree!.unmount();
  });
});

test('scroll-up clears follow and returning to the end restores it', async () => {
  let tree: TestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    tree = TestRenderer.create(
      <Harness entries={[entry('m1')]} openKey="c1:1" />,
    );
  });
  expect(listProps(tree!).maintainScrollAtEnd).toEqual(FOLLOW);

  await act(async () => {
    listProps(tree!).onScrollBeginDrag();
  });
  expect(listProps(tree!).maintainScrollAtEnd).toBeUndefined();

  await act(async () => {
    listProps(tree!).onEndVisible(true);
  });
  expect(listProps(tree!).maintainScrollAtEnd).toEqual(FOLLOW);

  await act(async () => {
    tree!.unmount();
  });
});

test('noteSent on an overflowed list keeps follow on', async () => {
  const listRef = React.createRef<SessionTranscriptListHandle>();
  const composerRef = React.createRef<View>();
  let tree: TestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    tree = TestRenderer.create(
      <SessionTranscriptList
        ref={listRef}
        openKey="c1:1"
        entries={[entry('m1'), entry('m2')]}
        renderEntry={({ item }: { item: MessageEntry }) => (
          <Text>{item.id}</Text>
        )}
        composerRef={composerRef}
        windowWidth={390}
        windowHeight={844}
        insetsTop={47}
        insetsBottom={34}
        onComposerHeight={() => {}}
        onShowScrollDown={() => {}}
        chatId="c1"
      />,
    );
  });
  expect(listProps(tree!).maintainScrollAtEnd).toEqual(FOLLOW);

  await act(async () => {
    listRef.current!.noteSent(2);
  });
  expect(listProps(tree!).maintainScrollAtEnd).toEqual(FOLLOW);

  await act(async () => {
    tree!.unmount();
  });
});

test('followEnd re-enables stick-to-bottom after a scroll-up', async () => {
  const listRef = React.createRef<SessionTranscriptListHandle>();
  const composerRef = React.createRef<View>();
  let tree: TestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    tree = TestRenderer.create(
      <SessionTranscriptList
        ref={listRef}
        openKey="c1:1"
        entries={[entry('m1')]}
        renderEntry={({ item }: { item: MessageEntry }) => (
          <Text>{item.id}</Text>
        )}
        composerRef={composerRef}
        windowWidth={390}
        windowHeight={844}
        insetsTop={47}
        insetsBottom={34}
        onComposerHeight={() => {}}
        onShowScrollDown={() => {}}
        chatId="c1"
      />,
    );
  });
  scrollMessageToEnd.mockClear();

  await act(async () => {
    listProps(tree!).onScrollBeginDrag();
  });
  expect(listProps(tree!).maintainScrollAtEnd).toBeUndefined();

  await act(async () => {
    await listRef.current!.followEnd({
      animated: true,
      closeKeyboard: false,
    });
  });
  expect(listProps(tree!).maintainScrollAtEnd).toEqual(FOLLOW);
  expect(scrollMessageToEnd).toHaveBeenCalledWith({
    animated: true,
    closeKeyboard: false,
  });

  await act(async () => {
    tree!.unmount();
  });
});

test('live extra height adds 1:1 to the transcript inset', async () => {
  const listRef = React.createRef<SessionTranscriptListHandle>();
  const composerRef = React.createRef<View>();
  const heights: number[] = [];
  let tree: TestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    tree = TestRenderer.create(
      <SessionTranscriptList
        ref={listRef}
        openKey="c1:1"
        entries={[entry('m1')]}
        renderEntry={({ item }: { item: MessageEntry }) => (
          <Text>{item.id}</Text>
        )}
        composerRef={composerRef}
        windowWidth={390}
        windowHeight={844}
        insetsTop={47}
        insetsBottom={34}
        onComposerHeight={h => heights.push(h)}
        onShowScrollDown={() => {}}
        chatId="c1"
      />,
    );
  });

  await act(async () => {
    listRef.current!.onComposerLayout(layoutEvent(200));
  });
  expect(heights.at(-1)).toBe(200);
  expect(lastReportedHeight()).toBe(200);

  await act(async () => {
    setComposerExtraHeightLive(40);
  });
  expect(heights.at(-1)).toBe(240);
  expect(lastReportedHeight()).toBe(240);

  await act(async () => {
    listRef.current!.onComposerLayout(layoutEvent(200));
  });
  expect(heights.at(-1)).toBe(240);
  expect(lastReportedHeight()).toBe(240);

  await act(async () => {
    listRef.current!.onComposerLayout(layoutEvent(292));
  });
  expect(heights.at(-1)).toBe(292);
  expect(lastReportedHeight()).toBe(292);

  await act(async () => {
    tree!.unmount();
  });
});

test('hides the message rail when there is only one entry', async () => {
  let tree: TestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    tree = TestRenderer.create(
      <Harness entries={[entry('m1')]} openKey="c1:1" />,
    );
  });
  await act(async () => {
    overflowList(tree!);
  });
  expect(
    tree!.root.findAll(n => n.props.testID === 'preview-rail'),
  ).toHaveLength(0);
  expect(listProps(tree!).showsVerticalScrollIndicator).toBe(true);

  await act(async () => {
    tree!.unmount();
  });
});

test('hides the message rail when content does not overflow', async () => {
  let tree: TestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    tree = TestRenderer.create(
      <Harness entries={[entry('m1'), entry('m2')]} openKey="c1:1" />,
    );
  });
  await act(async () => {
    tree!.root.findByProps({ testID: 'session-transcript' }).props.onLayout({
      nativeEvent: { layout: { x: 0, y: 0, width: 390, height: 844 } },
    });
    listProps(tree!).onContentSizeChange(390, 200);
  });
  expect(
    tree!.root.findAll(n => n.props.testID === 'preview-rail'),
  ).toHaveLength(0);

  await act(async () => {
    tree!.unmount();
  });
});

test('shows the message rail once content overflows two or more entries', async () => {
  let tree: TestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    tree = TestRenderer.create(
      <Harness entries={[entry('m1'), entry('m2')]} openKey="c1:1" />,
    );
  });
  await act(async () => {
    overflowList(tree!);
  });
  expect(
    tree!.root.findAll(n => n.props.testID === 'preview-rail').length,
  ).toBeGreaterThan(0);
  expect(
    tree!.root.findAll(
      n =>
        n.props.testID === 'preview-rail-item-m1' &&
        typeof n.props.onPress === 'function',
    ),
  ).toHaveLength(1);
  expect(
    tree!.root.findAll(
      n =>
        n.props.testID === 'preview-rail-item-m2' &&
        typeof n.props.onPress === 'function',
    ),
  ).toHaveLength(1);
  expect(listProps(tree!).showsVerticalScrollIndicator).toBe(false);
  expect(listProps(tree!).contentContainerStyle).toEqual(
    expect.arrayContaining([expect.objectContaining({ paddingRight: 40 })]),
  );

  await act(async () => {
    tree!.unmount();
  });
});

test('working status is not a rail tick', async () => {
  let tree: TestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    tree = TestRenderer.create(
      <Harness
        entries={[entry('m1'), entry('m2')]}
        openKey="c1:1"
        working
        startedAt={1}
      />,
    );
  });
  await act(async () => {
    overflowList(tree!);
  });
  expect(
    tree!.root.findAll(
      n =>
        String(n.props.testID ?? '').startsWith('preview-rail-item-') &&
        typeof n.props.onPress === 'function',
    ),
  ).toHaveLength(2);
  expect(
    tree!.root.findAll(n => n.props.testID === 'working-status-strip').length,
  ).toBeGreaterThan(0);

  await act(async () => {
    tree!.unmount();
  });
});

test('last rail tick follows the live edge', async () => {
  let tree: TestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    tree = TestRenderer.create(
      <Harness entries={[entry('m1'), entry('m2')]} openKey="c1:1" />,
    );
  });
  await act(async () => {
    overflowList(tree!);
    listProps(tree!).onScrollBeginDrag();
  });
  expect(listProps(tree!).maintainScrollAtEnd).toBeUndefined();
  scrollMessageToEnd.mockClear();

  await act(async () => {
    tree!.root
      .findAll(
        n =>
          n.props.testID === 'preview-rail-item-m2' &&
          typeof n.props.onPress === 'function',
      )[0]
      .props.onPress();
  });
  expect(scrollMessageToEnd).toHaveBeenCalledWith({
    animated: true,
    closeKeyboard: false,
  });
  expect(listProps(tree!).maintainScrollAtEnd).toEqual(FOLLOW);
  expect(scrollToIndex).not.toHaveBeenCalled();

  await act(async () => {
    tree!.unmount();
  });
});

test('a non-last rail tick jumps to that message and clears follow', async () => {
  let tree: TestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    tree = TestRenderer.create(
      <Harness entries={[entry('m1'), entry('m2')]} openKey="c1:1" />,
    );
  });
  await act(async () => {
    overflowList(tree!);
  });
  expect(listProps(tree!).maintainScrollAtEnd).toEqual(FOLLOW);

  await act(async () => {
    tree!.root
      .findAll(
        n =>
          n.props.testID === 'preview-rail-item-m1' &&
          typeof n.props.onPress === 'function',
      )[0]
      .props.onPress();
  });
  expect(scrollToIndex).toHaveBeenCalledWith({
    index: 0,
    animated: true,
    viewPosition: 0.5,
  });
  expect(listProps(tree!).maintainScrollAtEnd).toBeUndefined();

  await act(async () => {
    tree!.unmount();
  });
});

test('does not append a working row when the last entry is the assistant', async () => {
  const assistant: MessageEntry = { ...entry('a1'), role: 'assistant' };
  let tree: TestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    tree = TestRenderer.create(
      <Harness
        entries={[entry('m1'), assistant]}
        openKey="c1:1"
        working
        startedAt={1}
      />,
    );
  });
  expect(
    tree!.root.findAll(n => n.props.testID === 'working-status-strip'),
  ).toHaveLength(0);
  const ids = listProps(tree!).data.map(
    (row: { kind: string; entry?: MessageEntry }) =>
      row.kind === 'working' ? 'working' : row.entry?.id,
  );
  expect(ids).toEqual(['m1', 'a1']);
  await act(async () => {
    tree!.unmount();
  });
});

test('message rail stays right-aligned on a wide iPad column', async () => {
  let tree: TestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    tree = TestRenderer.create(
      <Harness
        entries={[entry('m1'), entry('m2')]}
        openKey="c1:1"
        windowWidth={1024}
        contentMaxWidth={720}
      />,
    );
  });
  await act(async () => {
    tree!.root.findByProps({ testID: 'session-transcript' }).props.onLayout({
      nativeEvent: { layout: { x: 0, y: 0, width: 684, height: 844 } },
    });
    listProps(tree!).onContentSizeChange(684, 2000);
  });
  const positioned = tree!.root.findAll(n => {
    const style = Array.isArray(n.props.style)
      ? n.props.style.flat()
      : [n.props.style];
    return style.some(
      (s: { right?: number } | undefined) => s?.right === RAIL_RIGHT,
    );
  });
  expect(positioned.length).toBeGreaterThan(0);
  await act(async () => {
    tree!.unmount();
  });
});

test('width change while following re-anchors to the end', async () => {
  let tree: TestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    tree = TestRenderer.create(
      <Harness entries={[entry('m1')]} openKey="c1:1" />,
    );
  });
  scrollMessageToEnd.mockClear();
  await act(async () => {
    tree!.root.findByProps({ testID: 'session-transcript' }).props.onLayout({
      nativeEvent: { layout: { x: 0, y: 0, width: 400, height: 844 } },
    });
  });
  await act(async () => {
    tree!.root.findByProps({ testID: 'session-transcript' }).props.onLayout({
      nativeEvent: { layout: { x: 0, y: 0, width: 800, height: 844 } },
    });
  });
  expect(scrollMessageToEnd).toHaveBeenCalledWith({
    animated: false,
    closeKeyboard: false,
  });
  await act(async () => {
    tree!.unmount();
  });
});

test('width change while not following restores the saved offset', async () => {
  let tree: TestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    tree = TestRenderer.create(
      <Harness entries={[entry('m1'), entry('m2')]} openKey="c1:1" />,
    );
  });
  await act(async () => {
    overflowList(tree!);
    listProps(tree!).onScrollBeginDrag();
    listProps(tree!).onScroll({
      nativeEvent: {
        contentOffset: { x: 0, y: 320 },
        contentSize: { width: 400, height: 2000 },
        layoutMeasurement: { width: 400, height: 844 },
      },
    });
  });
  scrollMessageToEnd.mockClear();
  scrollToOffset.mockClear();
  await act(async () => {
    tree!.root.findByProps({ testID: 'session-transcript' }).props.onLayout({
      nativeEvent: { layout: { x: 0, y: 0, width: 800, height: 844 } },
    });
  });
  await act(async () => {
    await new Promise<void>(resolve => {
      requestAnimationFrame(() => resolve());
    });
  });
  expect(scrollMessageToEnd).not.toHaveBeenCalled();
  expect(scrollToOffset).toHaveBeenCalledWith({
    offset: 320,
    animated: false,
  });
  await act(async () => {
    tree!.unmount();
  });
});
