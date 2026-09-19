import {
  EDGE_BACK_DISTANCE,
  EDGE_BACK_FLICK,
  EDGE_BACK_WIDTH,
  isEdgeStart,
  isHorizontalEdgeMove,
  shouldCommitEdgeBack,
} from '../src/navigation/edgeBackGesture';

test('isEdgeStart accepts only the leading strip', () => {
  expect(isEdgeStart(0)).toBe(true);
  expect(isEdgeStart(EDGE_BACK_WIDTH)).toBe(true);
  expect(isEdgeStart(EDGE_BACK_WIDTH + 1)).toBe(false);
  expect(isEdgeStart(120)).toBe(false);
  expect(isEdgeStart(-1)).toBe(false);
});

test('isHorizontalEdgeMove rejects mid-screen vertical pans', () => {
  expect(isHorizontalEdgeMove(20, 4)).toBe(true);
  expect(isHorizontalEdgeMove(6, 2)).toBe(false);
  expect(isHorizontalEdgeMove(12, 20)).toBe(false);
  expect(isHorizontalEdgeMove(-20, 0)).toBe(false);
});

test('shouldCommitEdgeBack uses distance or a flick', () => {
  expect(shouldCommitEdgeBack(EDGE_BACK_DISTANCE, 0)).toBe(true);
  expect(shouldCommitEdgeBack(40, 0)).toBe(false);
  expect(shouldCommitEdgeBack(30, EDGE_BACK_FLICK)).toBe(true);
  expect(shouldCommitEdgeBack(10, 2)).toBe(false);
});
