// Open-scroll: the transcript jumps to the tail once per openKey, then
// stays put while later messages append (follow is the list's job).

import React, { useRef } from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { FlatList, Text, View, type LayoutChangeEvent } from 'react-native';
import {
  SessionTranscriptList,
  LIST_RESIZE_REMOUNT_DELTA,
  RAIL_RIGHT,
  isTranscriptAtEnd,
  listEndDistance,
  type SessionTranscriptListHandle,
} from '../src/components/SessionTranscriptList';
import type { MessageEntry } from '../src/zeron/protocol/types';
import { setComposerExtraHeightLive } from '../src/zeron/state/uiPrefs';
import {
  beginComposerResize,
  COMPOSER_INSET_FALLBACK,
  composerBaseHeightSV,
  composerExtraHeightSV,
  composerInsetSV,
  endComposerResize,
  isComposerResizeActive,
  resetComposerInsetSeed,
} from '../src/components/composerExtraHeight';
import {
  COMPOSER_BELOW_PAD,
  COMPOSER_BOTTOM_FADE_BAND,
} from '../src/components/TopChromeFade';
import { flavourSeed, flavourWord } from '../src/components/workingMotion';

const flashMock = jest.requireMock('@shopify/flash-list') as {
  __scrollToEnd: jest.Mock;
  __scrollToIndex: jest.Mock;
  __scrollToOffset: jest.Mock;
};
const scrollToEnd = flashMock.__scrollToEnd;
const scrollToIndex = flashMock.__scrollToIndex;
const scrollToOffset = flashMock.__scrollToOffset;

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

function listProps(tree: TestRenderer.ReactTestRenderer) {
  return tree.root.findByType(FlatList).props;
}

function followingOn(tree: TestRenderer.ReactTestRenderer) {
  return listProps(tree).extraData === true;
}

function leaveEnd(tree: TestRenderer.ReactTestRenderer) {
  listProps(tree).onScroll({
    nativeEvent: {
      contentOffset: { x: 0, y: 0 },
      contentSize: { width: 390, height: 2000 },
      layoutMeasurement: { width: 390, height: 844 },
    },
  });
}

function returnToEnd(tree: TestRenderer.ReactTestRenderer, inset = 0) {
  listProps(tree).onScroll({
    nativeEvent: {
      contentOffset: { x: 0, y: 1156 + inset },
      contentSize: { width: 390, height: 2000 },
      layoutMeasurement: { width: 390, height: 844 },
    },
  });
}

function flattenStyle(style: unknown): Record<string, unknown>[] {
  if (style == null) return [];
  if (Array.isArray(style)) return style.flatMap(flattenStyle);
  if (typeof style === 'object') return [style as Record<string, unknown>];
  return [];
}

function listHorizontalPad(tree: TestRenderer.ReactTestRenderer): {
  paddingLeft?: number;
  paddingRight?: number;
} {
  const pad: { paddingLeft?: number; paddingRight?: number } = {};
  for (const s of flattenStyle(listProps(tree).contentContainerStyle)) {
    if (typeof s.paddingLeft === 'number') pad.paddingLeft = s.paddingLeft;
    if (typeof s.paddingRight === 'number') pad.paddingRight = s.paddingRight;
  }
  return pad;
}

function Harness({
  entries,
  openKey,
  working = false,
  startedAt = 1,
  windowWidth = 390,
  contentMaxWidth,
  onShowScrollDown = () => {},
}: {
  entries: MessageEntry[];
  openKey: string;
  working?: boolean;
  startedAt?: number;
  windowWidth?: number;
  contentMaxWidth?: number;
  onShowScrollDown?: (show: boolean) => void;
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
      onShowScrollDown={onShowScrollDown}
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
  scrollToEnd.mockClear();
  scrollToIndex.mockReset();
  scrollToIndex.mockImplementation(() => Promise.resolve());
  scrollToOffset.mockClear();
  if (isComposerResizeActive()) endComposerResize();
  setComposerExtraHeightLive(0);
  composerBaseHeightSV.value = 0;
  resetComposerInsetSeed();
});

test('listEndDistance is content minus offset minus viewport', () => {
  expect(listEndDistance(2000, 1156, 844)).toBe(0);
});

test('isTranscriptAtEnd requires the composer inset', () => {
  expect(isTranscriptAtEnd(0, 0)).toBe(true);
  expect(isTranscriptAtEnd(0, 200)).toBe(false);
  expect(isTranscriptAtEnd(-200, 200)).toBe(true);
  expect(isTranscriptAtEnd(-198, 200)).toBe(false);
});

test('content mask hides the pad below the glass, not the composer box', async () => {
  let tree: TestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    tree = TestRenderer.create(
      <Harness entries={[entry('m1')]} openKey="c1:1" />,
    );
  });
  const mask = tree!.root.findByProps({ testID: 'content-edge-mask' });
  expect(mask.props.maskElement.props.bottomInset).toBe(
    34 + COMPOSER_BELOW_PAD,
  );
  expect(mask.props.maskElement.props.bottomBand).toBe(
    COMPOSER_BOTTOM_FADE_BAND,
  );
  expect(mask.props.maskElement.props.bottomInset).not.toBe(
    COMPOSER_INSET_FALLBACK,
  );
  await act(async () => {
    tree?.unmount();
  });
});

test('scrolls to the bottom once when entries are present on mount', async () => {
  let tree: TestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    tree = TestRenderer.create(
      <Harness entries={[entry('m1')]} openKey="c1:1" />,
    );
  });
  expect(scrollToEnd).toHaveBeenCalledTimes(1);
  expect(scrollToEnd).toHaveBeenCalledWith({ animated: false });
  expect(followingOn(tree!)).toBe(true);
  await act(async () => {
    tree!.unmount();
  });
});

test('scrolls once when entries arrive after an empty open', async () => {
  let tree: TestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    tree = TestRenderer.create(<Harness entries={[]} openKey="c1:1" />);
  });
  expect(scrollToEnd).not.toHaveBeenCalled();

  await act(async () => {
    tree!.update(<Harness entries={[entry('m1')]} openKey="c1:1" />);
  });
  expect(scrollToEnd).toHaveBeenCalledTimes(1);

  await act(async () => {
    tree!.update(
      <Harness entries={[entry('m1'), entry('m2')]} openKey="c1:1" />,
    );
  });
  expect(scrollToEnd).toHaveBeenCalledTimes(1);

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
  expect(scrollToEnd).toHaveBeenCalledTimes(1);

  await act(async () => {
    tree!.update(<Harness entries={[entry('m1')]} openKey="c1:2" />);
  });
  expect(scrollToEnd).toHaveBeenCalledTimes(2);

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
  expect(followingOn(tree!)).toBe(true);

  await act(async () => {
    listProps(tree!).onScrollBeginDrag();
  });
  expect(followingOn(tree!)).toBe(false);

  await act(async () => {
    leaveEnd(tree!);
    returnToEnd(tree!, COMPOSER_INSET_FALLBACK);
  });
  expect(followingOn(tree!)).toBe(true);

  await act(async () => {
    tree!.unmount();
  });
});

test('screen-flush is not at end once the composer inset is published', async () => {
  const listRef = React.createRef<SessionTranscriptListHandle>();
  const composerRef = React.createRef<View>();
  const onShowScrollDown = jest.fn();
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
        onShowScrollDown={onShowScrollDown}
        chatId="c1"
      />,
    );
  });

  await act(async () => {
    listRef.current!.onComposerLayout(layoutEvent(200));
    returnToEnd(tree!, 200);
  });
  expect(followingOn(tree!)).toBe(true);

  await act(async () => {
    listProps(tree!).onScrollBeginDrag();
    leaveEnd(tree!);
  });
  expect(followingOn(tree!)).toBe(false);
  expect(onShowScrollDown).toHaveBeenCalledWith(true);

  await act(async () => {
    returnToEnd(tree!);
  });
  expect(followingOn(tree!)).toBe(false);
  expect(onShowScrollDown.mock.calls.at(-1)?.[0]).toBe(true);

  await act(async () => {
    returnToEnd(tree!, 200);
  });
  expect(followingOn(tree!)).toBe(true);
  expect(onShowScrollDown).toHaveBeenCalledWith(false);

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
  expect(followingOn(tree!)).toBe(true);

  await act(async () => {
    listRef.current!.noteSent(2);
  });
  expect(followingOn(tree!)).toBe(true);

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
  scrollToEnd.mockClear();

  await act(async () => {
    listProps(tree!).onScrollBeginDrag();
  });
  expect(followingOn(tree!)).toBe(false);

  await act(async () => {
    await listRef.current!.followEnd({
      animated: true,
      closeKeyboard: false,
    });
  });
  expect(followingOn(tree!)).toBe(true);
  expect(scrollToEnd).toHaveBeenCalledWith({ animated: true });

  await act(async () => {
    tree!.unmount();
  });
});

test('transcript inset follows measured composer height, not live extra', async () => {
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

  await act(async () => {
    setComposerExtraHeightLive(40);
  });
  expect(heights.at(-1)).toBe(200);
  expect(composerExtraHeightSV.value).toBe(40);

  await act(async () => {
    listRef.current!.onComposerLayout(layoutEvent(200));
  });
  expect(heights.at(-1)).toBe(200);

  await act(async () => {
    listRef.current!.onComposerLayout(layoutEvent(240));
  });
  expect(heights.at(-1)).toBe(240);
  expect(composerInsetSV.value).toBe(240);

  await act(async () => {
    tree!.unmount();
  });
});

test('resize-active extra height still tracks composer onLayout', async () => {
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

  await act(async () => {
    beginComposerResize();
    setComposerExtraHeightLive(40);
  });
  expect(heights.at(-1)).toBe(200);

  await act(async () => {
    listRef.current!.onComposerLayout(layoutEvent(240));
  });
  expect(heights.at(-1)).toBe(240);

  await act(async () => {
    endComposerResize();
  });
  expect(heights.at(-1)).toBe(240);

  await act(async () => {
    tree!.unmount();
  });
});

test('seeds composer inset from the last measured height', async () => {
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
  await act(async () => {
    listRef.current!.onComposerLayout(layoutEvent(220));
  });
  await act(async () => {
    tree!.unmount();
  });

  const seeded: number[] = [];
  await act(async () => {
    tree = TestRenderer.create(
      <SessionTranscriptList
        openKey="c2:1"
        entries={[entry('m1')]}
        renderEntry={({ item }: { item: MessageEntry }) => (
          <Text>{item.id}</Text>
        )}
        composerRef={composerRef}
        windowWidth={390}
        windowHeight={844}
        insetsTop={47}
        insetsBottom={34}
        onComposerHeight={h => seeded.push(h)}
        onShowScrollDown={() => {}}
        chatId="c2"
      />,
    );
  });
  expect(seeded[0]).toBe(220);
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
  expect(listHorizontalPad(tree!)).toEqual({
    paddingLeft: 0,
    paddingRight: 0,
  });

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
  expect(followingOn(tree!)).toBe(false);
  scrollToEnd.mockClear();

  await act(async () => {
    tree!.root
      .findAll(
        n =>
          n.props.testID === 'preview-rail-item-m2' &&
          typeof n.props.onPress === 'function',
      )[0]
      .props.onPress();
  });
  expect(scrollToEnd).toHaveBeenCalledWith({ animated: true });
  expect(followingOn(tree!)).toBe(true);
  expect(scrollToIndex).not.toHaveBeenCalled();

  await act(async () => {
    tree!.unmount();
  });
});

test('a non-last rail tick jumps after follow-output is off', async () => {
  let tree: TestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    tree = TestRenderer.create(
      <Harness entries={[entry('m1'), entry('m2')]} openKey="c1:1" />,
    );
  });
  await act(async () => {
    overflowList(tree!);
  });
  expect(followingOn(tree!)).toBe(true);

  let followingAtJump: boolean | undefined;
  scrollToIndex.mockImplementation(() => {
    followingAtJump = followingOn(tree!);
    return Promise.resolve();
  });

  await act(async () => {
    tree!.root
      .findAll(
        n =>
          n.props.testID === 'preview-rail-item-m1' &&
          typeof n.props.onPress === 'function',
      )[0]
      .props.onPress();
  });
  expect(followingOn(tree!)).toBe(false);
  expect(followingAtJump).toBe(false);
  expect(scrollToOffset).toHaveBeenCalledWith({
    offset: 0,
    animated: true,
  });
  expect(scrollToIndex).toHaveBeenCalledWith({
    index: 0,
    animated: true,
    viewPosition: 0.5,
  });

  await act(async () => {
    tree!.unmount();
  });
});

test('dragging the rail scrubs without animation once follow is off', async () => {
  let tree: TestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    tree = TestRenderer.create(
      <Harness
        entries={[entry('m1'), entry('m2'), entry('m3'), entry('m4')]}
        openKey="c1:1"
      />,
    );
  });
  await act(async () => {
    overflowList(tree!);
    listProps(tree!).onScrollBeginDrag();
  });
  expect(followingOn(tree!)).toBe(false);
  scrollToIndex.mockClear();
  scrollToOffset.mockClear();

  const track = tree!.root.findByProps({ testID: 'preview-rail-track' });
  const railHeight = 844 - (47 + 96) - COMPOSER_INSET_FALLBACK;
  const itemSize = 14;
  const stackTop = (railHeight - itemSize * 4) / 2;
  const yFor = (index: number) => stackTop + index * itemSize + itemSize / 2;
  const touch = (index: number) => ({
    nativeEvent: { locationY: yFor(index), pageY: yFor(index) },
  });
  const maxOffset = 2000 - 844;
  const progressAt = (index: number) =>
    (index * itemSize + itemSize / 2) / (itemSize * 4);

  await act(async () => {
    track.props.onResponderGrant(touch(0));
  });
  expect(scrollToOffset).toHaveBeenCalledWith({
    offset: 0,
    animated: true,
  });
  expect(scrollToIndex).toHaveBeenCalledWith({
    index: 0,
    animated: true,
    viewPosition: 0.5,
  });
  scrollToIndex.mockClear();
  scrollToOffset.mockClear();

  await act(async () => {
    track.props.onResponderMove(touch(1));
    track.props.onResponderMove(touch(2));
  });
  expect(scrollToIndex).not.toHaveBeenCalled();
  expect(scrollToOffset).toHaveBeenCalledWith({
    offset: progressAt(2) * maxOffset,
    animated: false,
  });

  await act(async () => {
    tree!.unmount();
  });
});

test('dragging inside a tick still scrolls proportionally', async () => {
  let tree: TestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    tree = TestRenderer.create(
      <Harness
        entries={[entry('m1'), entry('m2'), entry('m3'), entry('m4')]}
        openKey="c1:1"
      />,
    );
  });
  await act(async () => {
    overflowList(tree!);
    listProps(tree!).onScrollBeginDrag();
  });
  const track = tree!.root.findByProps({ testID: 'preview-rail-track' });
  const railHeight = 844 - (47 + 96) - COMPOSER_INSET_FALLBACK;
  const itemSize = 14;
  const stackTop = (railHeight - itemSize * 4) / 2;
  const maxOffset = 2000 - 844;
  const y0 = stackTop + itemSize * 0.2;
  const y1 = stackTop + itemSize * 0.8;
  const touchAt = (y: number) => ({
    nativeEvent: { locationY: y, pageY: y },
  });

  await act(async () => {
    track.props.onResponderGrant(touchAt(y0));
  });
  scrollToIndex.mockClear();
  scrollToOffset.mockClear();

  await act(async () => {
    track.props.onResponderMove(touchAt(y1));
  });
  expect(scrollToIndex).not.toHaveBeenCalled();
  expect(scrollToOffset).toHaveBeenCalledWith({
    offset: ((itemSize * 0.8) / (itemSize * 4)) * maxOffset,
    animated: false,
  });

  await act(async () => {
    tree!.unmount();
  });
});

test('dragging onto the last tick follows the live edge', async () => {
  let tree: TestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    tree = TestRenderer.create(
      <Harness
        entries={[entry('m1'), entry('m2'), entry('m3'), entry('m4')]}
        openKey="c1:1"
      />,
    );
  });
  await act(async () => {
    overflowList(tree!);
    listProps(tree!).onScrollBeginDrag();
  });
  expect(followingOn(tree!)).toBe(false);
  const track = tree!.root.findByProps({ testID: 'preview-rail-track' });
  const railHeight = 844 - (47 + 96) - COMPOSER_INSET_FALLBACK;
  const itemSize = 14;
  const stackTop = (railHeight - itemSize * 4) / 2;
  const yFor = (index: number) => stackTop + index * itemSize + itemSize / 2;
  const touch = (index: number) => ({
    nativeEvent: { locationY: yFor(index), pageY: yFor(index) },
  });

  await act(async () => {
    track.props.onResponderGrant(touch(0));
  });
  scrollToEnd.mockClear();
  scrollToIndex.mockClear();
  scrollToOffset.mockClear();

  await act(async () => {
    track.props.onResponderMove(touch(3));
  });
  expect(followingOn(tree!)).toBe(true);
  expect(scrollToEnd).toHaveBeenCalledWith({ animated: false });
  expect(scrollToIndex).not.toHaveBeenCalled();

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
  expect(listHorizontalPad(tree!)).toEqual({
    paddingLeft: 0,
    paddingRight: 0,
  });
  await act(async () => {
    tree!.unmount();
  });
});

test('wide iPad transcript uses equal gutters around the measure cap', async () => {
  let tree: TestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    tree = TestRenderer.create(
      <Harness
        entries={[entry('m1')]}
        openKey="c1:1"
        windowWidth={1024}
        contentMaxWidth={720}
      />,
    );
  });
  await act(async () => {
    tree!.root.findByProps({ testID: 'session-transcript' }).props.onLayout({
      nativeEvent: { layout: { x: 0, y: 0, width: 1000, height: 844 } },
    });
  });
  expect(listHorizontalPad(tree!)).toEqual({
    paddingLeft: 140,
    paddingRight: 140,
  });
  await act(async () => {
    tree!.unmount();
  });
});

test('wide overflowing iPad transcript does not add extra rail padding', async () => {
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
      nativeEvent: { layout: { x: 0, y: 0, width: 1000, height: 844 } },
    });
    listProps(tree!).onContentSizeChange(1000, 2000);
  });
  expect(
    tree!.root.findAll(n => n.props.testID === 'preview-rail').length,
  ).toBeGreaterThan(0);
  expect(listHorizontalPad(tree!)).toEqual({
    paddingLeft: 140,
    paddingRight: 140,
  });
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
  scrollToEnd.mockClear();
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
  expect(scrollToEnd).toHaveBeenCalledWith({ animated: false });
  await act(async () => {
    tree!.unmount();
  });
});

test('width change while not following keeps the list mounted', async () => {
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
  scrollToEnd.mockClear();
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
  expect(scrollToEnd).not.toHaveBeenCalled();
  expect(scrollToOffset).not.toHaveBeenCalled();
  expect(listProps(tree!).testID).toBe('session-transcript-list');
  await act(async () => {
    tree!.unmount();
  });
});

test('sub-delta width ticks do not remount or restore scroll', async () => {
  let tree: TestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    tree = TestRenderer.create(
      <Harness entries={[entry('m1')]} openKey="c1:1" />,
    );
  });
  await act(async () => {
    tree!.root.findByProps({ testID: 'session-transcript' }).props.onLayout({
      nativeEvent: { layout: { x: 0, y: 0, width: 400, height: 844 } },
    });
  });
  expect(listProps(tree!).testID).toBe('session-transcript-list');
  scrollToEnd.mockClear();
  scrollToOffset.mockClear();
  const tick = LIST_RESIZE_REMOUNT_DELTA - 1;
  await act(async () => {
    tree!.root.findByProps({ testID: 'session-transcript' }).props.onLayout({
      nativeEvent: {
        layout: { x: 0, y: 0, width: 400 + tick, height: 844 },
      },
    });
  });
  await act(async () => {
    tree!.root.findByProps({ testID: 'session-transcript' }).props.onLayout({
      nativeEvent: {
        layout: { x: 0, y: 0, width: 400 + tick * 2, height: 844 },
      },
    });
  });
  await act(async () => {
    await new Promise<void>(resolve => {
      requestAnimationFrame(() => resolve());
    });
  });
  expect(listProps(tree!).testID).toBe('session-transcript-list');
  expect(scrollToEnd).not.toHaveBeenCalled();
  expect(scrollToOffset).not.toHaveBeenCalled();

  await act(async () => {
    tree!.root.findByProps({ testID: 'session-transcript' }).props.onLayout({
      nativeEvent: {
        layout: {
          x: 0,
          y: 0,
          width: 400 + tick * 2 + LIST_RESIZE_REMOUNT_DELTA,
          height: 844,
        },
      },
    });
  });
  await act(async () => {
    await new Promise<void>(resolve => {
      requestAnimationFrame(() => resolve());
    });
  });
  expect(listProps(tree!).testID).toBe('session-transcript-list');
  expect(scrollToEnd).toHaveBeenCalledWith({ animated: false });
  await act(async () => {
    tree!.unmount();
  });
});
