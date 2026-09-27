import type { MessageEntry } from '../src/zeron/protocol/types';
import {
  ASSISTANT_SLICE_CHARS,
  TRANSCRIPT_PAGE,
  TRANSCRIPT_WINDOW,
  rangeAround,
  shiftRange,
  slicesForEntry,
  tailRange,
} from '../src/components/transcriptWindow';

const entry = (
  id: string,
  role: 'user' | 'assistant',
  text: string,
  status?: MessageEntry['status'],
): MessageEntry => ({
  id,
  role,
  parts: [{ kind: 'text', id: `${id}-t`, text }],
  createdAt: 1,
  deviceId: 'd1',
  status,
});

test('tailRange shows the whole thread until it exceeds the window', () => {
  expect(tailRange(0)).toEqual({ start: 0, end: 0 });
  expect(tailRange(3)).toEqual({ start: 0, end: 3 });
  expect(tailRange(TRANSCRIPT_WINDOW + 25)).toEqual({
    start: 25,
    end: TRANSCRIPT_WINDOW + 25,
  });
});

test('shiftRange pages without growing the window', () => {
  const tail = tailRange(120);
  const earlier = shiftRange(tail, 120, -1);
  expect(earlier.end - earlier.start).toBe(TRANSCRIPT_WINDOW);
  expect(earlier.start).toBe(tail.start - TRANSCRIPT_PAGE);
  expect(shiftRange({ start: 0, end: TRANSCRIPT_WINDOW }, 120, -1)).toEqual({
    start: 0,
    end: TRANSCRIPT_WINDOW,
  });
  const later = shiftRange(earlier, 120, 1);
  expect(later.start).toBe(earlier.start + TRANSCRIPT_PAGE);
  expect(later.end - later.start).toBe(TRANSCRIPT_WINDOW);
});

test('rangeAround centers a message and clamps to the thread', () => {
  expect(rangeAround(0, 120).start).toBe(0);
  expect(rangeAround(0, 120).end).toBe(TRANSCRIPT_WINDOW);
  const mid = rangeAround(80, 120);
  expect(mid.end - mid.start).toBe(TRANSCRIPT_WINDOW);
  expect(mid.start).toBeLessThanOrEqual(80);
  expect(mid.end).toBeGreaterThan(80);
  expect(rangeAround(119, 120)).toEqual(tailRange(120));
});

test('long settled assistant turns split; streaming and short turns do not', () => {
  const short = entry('a', 'assistant', 'hello');
  expect(slicesForEntry(short)).toEqual([
    {
      key: 'a',
      parts: short.parts,
      showTail: true,
      continued: false,
    },
  ]);
  const streaming = entry(
    's',
    'assistant',
    'x'.repeat(ASSISTANT_SLICE_CHARS * 3),
    'streaming',
  );
  expect(slicesForEntry(streaming)).toHaveLength(1);

  const user = entry('u', 'user', 'x'.repeat(ASSISTANT_SLICE_CHARS * 3));
  expect(slicesForEntry(user)).toHaveLength(1);

  const long = entry('L', 'assistant', 'x'.repeat(ASSISTANT_SLICE_CHARS * 3));
  const slices = slicesForEntry(long);
  expect(slices.length).toBeGreaterThan(1);
  expect(slices[0]?.continued).toBe(false);
  expect(slices[0]?.showTail).toBe(false);
  expect(slices[slices.length - 1]?.showTail).toBe(true);
  expect(slices[slices.length - 1]?.continued).toBe(true);
  expect(new Set(slices.map(slice => slice.key)).size).toBe(slices.length);
  const text = slices
    .flatMap(slice => slice.parts)
    .map(part => (part.kind === 'text' ? part.text : ''))
    .join('');
  expect(text).toBe('x'.repeat(ASSISTANT_SLICE_CHARS * 3));
});
