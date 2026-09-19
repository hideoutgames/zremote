// Open-scroll: the transcript jumps to the tail once per openKey, then
// stays put while later messages append (follow is the list's job).

import React, { useRef } from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Text, View, type LayoutChangeEvent } from 'react-native';
import {
  SessionTranscriptList,
  type SessionTranscriptListHandle,
} from '../src/components/SessionTranscriptList';
import type { MessageEntry } from '../src/zeron/protocol/types';
import {
  setComposerExtraHeightLive,
  uiPrefsStore,
} from '../src/zeron/state/uiPrefs';

const keyboardMock = jest.requireMock('@legendapp/list/keyboard') as {
  __scrollMessageToEnd: jest.Mock;
  __onComposerLayout: jest.Mock;
};
const scrollMessageToEnd = keyboardMock.__scrollMessageToEnd;
const reportComposerInset = keyboardMock.__onComposerLayout;

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

function Harness({
  entries,
  openKey,
}: {
  entries: MessageEntry[];
  openKey: string;
}) {
  const composerRef = useRef<View>(null);
  return (
    <SessionTranscriptList
      openKey={openKey}
      entries={entries}
      renderEntry={({ item }: { item: MessageEntry }) => <Text>{item.id}</Text>}
      composerRef={composerRef}
      windowWidth={390}
      windowHeight={844}
      insetsTop={47}
      insetsBottom={34}
      onComposerHeight={() => {}}
      onShowScrollDown={() => {}}
    />
  );
}

beforeEach(() => {
  scrollMessageToEnd.mockClear();
  reportComposerInset.mockClear();
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
