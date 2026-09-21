// QueuePanel drag-to-reorder: the row's PanResponder must survive the
// per-frame `dragDy` re-render — recreating it mid-gesture reset its internal
// gesture state so the release delta collapsed to ~0 and the move was dropped.

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { QueuePanel } from '../src/components/QueuePanel';
import type { QueuedMessage } from '../src/zeron/protocol/types';
import {
  getSessionStore,
  moveQueuedInStore,
} from '../src/zeron/state/sessionStores';
import { enterTestMode, exitTestMode } from '../src/zeron/testMode/testMode';

const item = (id: string): QueuedMessage => ({
  id,
  text: `message ${id}`,
  issuedBy: 'tester',
  issuedAt: Date.now(),
});

// Minimal touchHistory shape consumed by PanResponder's gesture accounting:
// a single active touch moving previousPageY -> currentPageY at `ts`.
let clock = 1_000;
const makeEvent = (y: number, prevY: number) => {
  clock += 16;
  return {
    touchHistory: {
      touchBank: [
        {
          touchActive: true,
          startPageX: 10,
          startPageY: 0,
          currentPageX: 10,
          currentPageY: y,
          previousPageX: 10,
          previousPageY: prevY,
          currentTimeStamp: clock,
          previousTimeStamp: clock - 16,
          startTimeStamp: 1,
        },
      ],
      indexOfSingleActiveTouch: 0,
      mostRecentTimeStamp: clock,
      numberActiveTouches: 1,
    },
    nativeEvent: {
      touches: [{ pageX: 10, pageY: y }],
      changedTouches: [{ pageX: 10, pageY: y }],
    },
  } as never;
};

interface ResponderProps {
  onStartShouldSetResponderCapture?: (e: unknown) => boolean;
  onStartShouldSetResponder?: (e: unknown) => boolean;
  onResponderGrant?: (e: unknown) => void;
  onResponderMove?: (e: unknown) => void;
  onResponderRelease?: (e: unknown) => void;
}

const renderPanel = (onMove: (id: string, to: number) => void) =>
  TestRenderer.create(
    <QueuePanel
      queue={[item('a'), item('b'), item('c')]}
      actionsSupported
      pending={new Set()}
      canSteer={false}
      onAction={() => {}}
      onMove={onMove}
      onDragging={() => {}}
    />,
  );

/** Drag row 0 down through `steps` (pixel positions), then release — driving
 * the real responder callbacks so gestureState lives inside the PanResponder
 * instance, exactly like a device gesture. Re-reads the handle props after
 * every move, matching how RN dispatches to whichever handlers the re-render
 * left on the view. */
async function simulateDrag(
  tree: TestRenderer.ReactTestRenderer,
  steps: number[],
) {
  const props = () =>
    tree.root.findAllByProps({ testID: 'queue-reorder-handle' })[0]
      .props as ResponderProps;

  await act(async () => {
    const start = makeEvent(0, 0);
    props().onStartShouldSetResponderCapture?.(start);
    props().onStartShouldSetResponder?.(start);
    props().onResponderGrant?.(start);
  });
  let prev = 0;
  for (const y of steps) {
    const e = makeEvent(y, prev);
    prev = y;
    await act(async () => {
      props().onResponderMove?.(e);
    });
  }
  await act(async () => {
    props().onResponderRelease?.(makeEvent(prev, prev));
  });
}

test('a one-slot drag calls onMove with the target index', async () => {
  const moves: Array<[string, number]> = [];
  let tree: TestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    tree = renderPanel((id, to) => moves.push([id, to]));
  });
  // ROW_PITCH = 64: ~70pt must move 'a' from index 0 to index 1.
  await simulateDrag(tree!, [20, 45, 70]);
  expect(moves).toEqual([['a', 1]]);
});

test('the gesture keeps its accumulated dy across per-move re-renders', async () => {
  const moves: Array<[string, number]> = [];
  let tree: TestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    tree = renderPanel((id, to) => moves.push([id, to]));
  });
  // Multi-frame drag to ~2 slots. With the pre-fix per-render
  // PanResponder.create, each move's setDragDy re-render swapped in a fresh
  // responder whose gestureState only saw the last frame's delta, so the
  // release computed round(tiny/64) = 0 and no move was emitted.
  await simulateDrag(tree!, [20, 45, 70, 100, 130]);
  expect(moves).toEqual([['a', 2]]);
});

test('moveQueuedInStore reorders the queue without a controller', async () => {
  enterTestMode();
  const store = getSessionStore('chat-deploy-runbook');
  const ids = store.getState().queue.map(q => q.id);
  expect(ids.length).toBeGreaterThanOrEqual(3);

  expect(moveQueuedInStore('chat-deploy-runbook', ids[2], 0)).toBe(true);
  expect(
    getSessionStore('chat-deploy-runbook')
      .getState()
      .queue.map(q => q.id),
  ).toEqual([ids[2], ids[0], ids[1]]);

  // Clamped: an out-of-range target lands at the end; unknown id is a no-op.
  expect(moveQueuedInStore('chat-deploy-runbook', ids[0], 99)).toBe(true);
  expect(moveQueuedInStore('chat-deploy-runbook', 'nope', 0)).toBe(false);
  exitTestMode();
});
