import type { MessageEntry } from '../src/zeron/protocol/types';
import {
  FOLLOW_THRESHOLD,
  PREVIEW_DESCRIPTION_LENGTH,
  PREVIEW_TITLE_LENGTH,
  buildRailItems,
  collapseMessageText,
  entryPreviewText,
  getMessagePreview,
  pickActiveRailId,
  railIndexAtY,
  railItemSize,
  railProgressAtY,
  railYFromPage,
  tickScale,
  truncateMessageText,
} from '../src/components/agentsKit/messagePreview';

const entry = (
  id: string,
  role: MessageEntry['role'],
  text: string,
): MessageEntry => ({
  id,
  role,
  parts: text ? [{ kind: 'text', id: `t-${id}`, text }] : [],
  createdAt: 1,
  deviceId: 'd1',
  status: 'complete',
});

test('truncateMessageText keeps short text and ellipsizes on a word boundary', () => {
  expect(truncateMessageText('hello', 56)).toBe('hello');
  const long = 'one two three four five six seven eight nine ten eleven';
  expect(truncateMessageText(long, 20)).toBe('one two three four…');
});

test('entryPreviewText hides attachment trailers and pending refs', () => {
  const raw = [
    'look at this',
    '',
    'Attached images (local files — open them to view):',
    '- pending://up-1/photo.png',
  ].join('\n');
  expect(entryPreviewText(entry('m1', 'user', raw))).toBe('look at this');
  const only = [
    'See the attached image(s).',
    '',
    'Attached images (local files — open them to view):',
    '- /host/uploads/photo.png',
  ].join('\n');
  expect(entryPreviewText(entry('m2', 'user', only))).toBe('photo.png');
});

test('collapseMessageText and entryPreviewText flatten whitespace', () => {
  expect(collapseMessageText('  a \n\t b  ')).toBe('a b');
  expect(entryPreviewText(entry('m1', 'user', 'hello\n  there'))).toBe(
    'hello there',
  );
});

test('short user label uses the next assistant message as description', () => {
  const preview = getMessagePreview(
    'What should the first release include?',
    'Start with the smallest workflow that still feels complete.',
    'Message',
  );
  expect(preview.label).toBe('What should the first release include?');
  expect(preview.description).toBe(
    'Start with the smallest workflow that still feels complete.',
  );
});

test('long user text splits into title and remainder description', () => {
  const text =
    'Include streaming and recovery states too so the first version feels dependable in real use.';
  expect(text.length).toBeGreaterThan(PREVIEW_TITLE_LENGTH);
  const preview = getMessagePreview(text, undefined, 'Message');
  expect(preview.label.endsWith('…')).toBe(true);
  expect(preview.label.length).toBeLessThanOrEqual(PREVIEW_TITLE_LENGTH + 1);
  expect(preview.description).toBeDefined();
  expect(preview.description!.length).toBeLessThanOrEqual(
    PREVIEW_DESCRIPTION_LENGTH + 1,
  );
});

test('empty text falls back to the supplied label', () => {
  expect(getMessagePreview('', undefined, 'Message')).toEqual({
    label: 'Message',
    description: undefined,
  });
  expect(entryPreviewText(entry('empty', 'assistant', ''))).toBe('');
});

test('buildRailItems is one tick per entry and pairs user + assistant', () => {
  const items = buildRailItems(
    [
      entry('u1', 'user', 'What should the first release include?'),
      entry('a1', 'assistant', 'Start with the smallest workflow.'),
    ],
    {
      emptyLabel: 'Message',
      goToLabel: (role, n, total) => `Go to ${role} message ${n} of ${total}`,
    },
  );
  expect(items).toHaveLength(2);
  expect(items[0]).toMatchObject({
    id: 'u1',
    label: 'What should the first release include?',
    description: 'Start with the smallest workflow.',
    ariaLabel: 'Go to user message 1 of 2',
  });
  expect(items[1]).toMatchObject({
    id: 'a1',
    label: 'Start with the smallest workflow.',
    ariaLabel: 'Go to assistant message 2 of 2',
  });
});

test('pickActiveRailId pins first/last near the edges', () => {
  const ids = ['a', 'b', 'c'];
  expect(
    pickActiveRailId({
      itemIds: ids,
      offset: FOLLOW_THRESHOLD,
      viewportHeight: 400,
      contentHeight: 2000,
    }),
  ).toBe('a');
  expect(
    pickActiveRailId({
      itemIds: ids,
      offset: 2000 - 400 - FOLLOW_THRESHOLD,
      viewportHeight: 400,
      contentHeight: 2000,
    }),
  ).toBe('c');
  expect(
    pickActiveRailId({
      itemIds: ids,
      offset: 800,
      viewportHeight: 400,
      contentHeight: 2000,
    }),
  ).toBe('b');
});

test('pickActiveRailId tracks scroll position proportionally', () => {
  const ids = ['a', 'b', 'c', 'd', 'e'];
  const mid = pickActiveRailId({
    itemIds: ids,
    offset: 800,
    viewportHeight: 400,
    contentHeight: 2000,
  });
  expect(mid).toBe('c');
  // Quarter-way down → second tick, not the first.
  expect(
    pickActiveRailId({
      itemIds: ids,
      offset: 400,
      viewportHeight: 400,
      contentHeight: 2000,
    }),
  ).toBe('b');
});

test('railItemSize compresses only when ticks would overflow', () => {
  expect(railItemSize(4, 200)).toBe(14);
  expect(railItemSize(20, 140)).toBe(7);
});

test('railIndexAtY maps Y onto a clamped tick index', () => {
  expect(railIndexAtY(0, 4, 14, 0)).toBe(0);
  expect(railIndexAtY(13.9, 4, 14, 0)).toBe(0);
  expect(railIndexAtY(14, 4, 14, 0)).toBe(1);
  expect(railIndexAtY(41, 4, 14, 0)).toBe(2);
  expect(railIndexAtY(1000, 4, 14, 0)).toBe(3);
  expect(railIndexAtY(-8, 4, 14, 0)).toBe(0);
  expect(railIndexAtY(20, 4, 14, 20)).toBe(0);
  expect(railIndexAtY(34, 4, 14, 20)).toBe(1);
  expect(railIndexAtY(0, 0, 14, 0)).toBe(0);
  expect(railIndexAtY(10, 4, 0, 0)).toBe(0);
});

test('railProgressAtY maps Y onto clamped 0..1 stack progress', () => {
  expect(railProgressAtY(0, 4, 14, 0)).toBe(0);
  expect(railProgressAtY(28, 4, 14, 0)).toBe(0.5);
  expect(railProgressAtY(56, 4, 14, 0)).toBe(1);
  expect(railProgressAtY(1000, 4, 14, 0)).toBe(1);
  expect(railProgressAtY(-8, 4, 14, 0)).toBe(0);
  expect(railProgressAtY(34, 4, 14, 20)).toBe(14 / 56);
  expect(railProgressAtY(10, 0, 14, 0)).toBe(0);
  expect(railProgressAtY(10, 4, 0, 0)).toBe(0);
});

test('railYFromPage prefers locationY and only uses measured pageY', () => {
  expect(railYFromPage(undefined, 40, null)).toBe(40);
  expect(railYFromPage(800, 40, null)).toBe(40);
  expect(railYFromPage(160, undefined, 120)).toBe(40);
  expect(railYFromPage(160, undefined, null)).toBe(0);
  expect(railYFromPage(undefined, undefined, null)).toBe(0);
});

test('tickScale is a four-step pyramid', () => {
  expect(tickScale(0)).toBe(1);
  expect(tickScale(1)).toBe(0.68);
  expect(tickScale(2)).toBe(0.44);
  expect(tickScale(3)).toBe(0.25);
});
