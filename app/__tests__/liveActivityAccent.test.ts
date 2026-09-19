import {
  ACTIVITY_COLORS,
  activityAccent,
} from '../src/liveActivity/activityAccent';
import { planAwaitingReview } from '../src/liveActivity/planAwaitingReview';
import type { MessageEntry } from '../src/zeron/protocol/types';

test('activityAccent precedence: question > plan > open PR > merged > running', () => {
  expect(
    activityAccent({
      awaitingInput: true,
      planReady: true,
      prTone: 'open',
    }).kind,
  ).toBe('question');
  expect(
    activityAccent({
      awaitingInput: false,
      planReady: true,
      prTone: 'open',
    }).kind,
  ).toBe('planReady');
  expect(
    activityAccent({
      awaitingInput: false,
      planReady: false,
      prTone: 'open',
    }),
  ).toEqual({
    kind: 'openPr',
    color: ACTIVITY_COLORS.openPr,
    glyph: 'arrow.triangle.pull',
  });
  expect(
    activityAccent({
      awaitingInput: false,
      planReady: false,
      prTone: 'merged',
    }).color,
  ).toBe(ACTIVITY_COLORS.mergedPr);
  expect(
    activityAccent({
      awaitingInput: false,
      planReady: false,
      prTone: 'draft',
    }).color,
  ).toBe(ACTIVITY_COLORS.running);
  expect(
    activityAccent({
      awaitingInput: false,
      planReady: false,
      prTone: null,
    }).color,
  ).toBe(ACTIVITY_COLORS.running);
});

const assistantPlan = (): MessageEntry => ({
  id: 'a1',
  role: 'assistant',
  createdAt: 1,
  deviceId: 'd1',
  status: 'complete',
  parts: [
    {
      kind: 'tool',
      id: 't1',
      call: {
        kind: 'unknown',
        name: 'createPlan',
        input: { name: 'Fix', plan: '# Fix\n\nDo it.' },
      },
      resolved: true,
    },
  ],
});

test('planAwaitingReview: idle + last assistant plan + no later user', () => {
  expect(planAwaitingReview([assistantPlan()], 'idle')).toBe(true);
  expect(planAwaitingReview([assistantPlan()], 'working')).toBe(false);
  expect(
    planAwaitingReview(
      [
        assistantPlan(),
        {
          id: 'u1',
          role: 'user',
          createdAt: 2,
          deviceId: 'p',
          parts: [{ kind: 'text', text: 'go' }],
        },
      ],
      'idle',
    ),
  ).toBe(false);
});
