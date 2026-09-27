// Long threads are not one FlashList of every message. A bounded window
// keeps layout estimates honest, and oversized assistant turns are split
// into several rows so one cell cannot grow past what the list can scroll.

import type { MessageEntry, MessagePart } from '../zeron/protocol/types';
import { consumedPlanTextIds } from './transcript/detectPlan';

/** Messages mounted at once. Enough context to read; small enough that
 *  variable-height measurement cannot run away on a multi-thousand-turn
 *  thread. */
export const TRANSCRIPT_WINDOW = 40;
/** How many messages to reveal when the reader hits either edge. */
export const TRANSCRIPT_PAGE = 20;
/** Soft cap on one assistant row. Above this, the turn is split so each
 *  bubble stays under the iOS layer-size limit and FlashList can recycle
 *  the rest. */
export const ASSISTANT_SLICE_CHARS = 1600;

export type EntryRange = { start: number; end: number };

export type EntrySlice = {
  key: string;
  parts: MessagePart[];
  showTail: boolean;
  continued: boolean;
};

export const tailRange = (
  count: number,
  window = TRANSCRIPT_WINDOW,
): EntryRange => {
  const end = Math.max(0, count);
  return { start: Math.max(0, end - window), end };
};

export const rangeAround = (
  index: number,
  count: number,
  window = TRANSCRIPT_WINDOW,
): EntryRange => {
  if (count <= window) return { start: 0, end: Math.max(0, count) };
  const clamped = Math.max(0, Math.min(count - 1, index));
  const start = Math.max(
    0,
    Math.min(clamped - Math.floor(window / 2), count - window),
  );
  return { start, end: start + window };
};

export const shiftRange = (
  range: EntryRange,
  count: number,
  direction: -1 | 1,
  page = TRANSCRIPT_PAGE,
  window = TRANSCRIPT_WINDOW,
): EntryRange => {
  const safeCount = Math.max(0, count);
  if (direction < 0) {
    if (range.start <= 0) return range;
    const start = Math.max(0, range.start - page);
    return { start, end: Math.min(safeCount, start + window) };
  }
  if (range.end >= safeCount) return range;
  const end = Math.min(safeCount, range.end + page);
  return { start: Math.max(0, end - window), end };
};

export const sameRange = (a: EntryRange, b: EntryRange): boolean =>
  a.start === b.start && a.end === b.end;

const partWeight = (part: MessagePart): number =>
  part.kind === 'text' || part.kind === 'reasoning' ? part.text.length : 280;

const splitText = (text: string, maxChars: number): string[] => {
  if (maxChars <= 0 || text.length <= maxChars) return [text];
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(text.length, start + maxChars);
    if (end < text.length) {
      const newline = text.lastIndexOf('\n', end);
      if (newline > start + maxChars * 0.5) end = newline + 1;
    }
    if (end <= start) end = Math.min(text.length, start + maxChars);
    chunks.push(text.slice(start, end));
    start = end;
  }
  return chunks.length > 0 ? chunks : [text];
};

const wholeSlice = (entry: MessageEntry): EntrySlice => ({
  key: entry.id,
  parts: entry.parts,
  showTail: true,
  continued: false,
});

/** One row for ordinary turns. Long settled assistant turns become several
 *  rows; the last one keeps the plan card, files, and worked-for caption. */
export const slicesForEntry = (entry: MessageEntry): EntrySlice[] => {
  if (entry.role !== 'assistant' || entry.status === 'streaming') {
    return [wholeSlice(entry)];
  }
  const total = entry.parts.reduce((sum, part) => sum + partWeight(part), 0);
  if (total <= ASSISTANT_SLICE_CHARS) return [wholeSlice(entry)];

  const hidden = consumedPlanTextIds(entry);
  const slices: MessagePart[][] = [];
  let bucket: MessagePart[] = [];
  let used = 0;
  const emit = () => {
    if (bucket.length === 0) return;
    slices.push(bucket);
    bucket = [];
    used = 0;
  };
  for (const part of entry.parts) {
    if (part.kind === 'text' && hidden.has(part.id)) continue;
    if (
      (part.kind === 'text' || part.kind === 'reasoning') &&
      part.text.length > ASSISTANT_SLICE_CHARS
    ) {
      emit();
      const chunks = splitText(part.text, ASSISTANT_SLICE_CHARS);
      chunks.forEach((text, i) => {
        slices.push([
          {
            ...part,
            id: i === 0 ? part.id : `${part.id}~${i}`,
            text,
          },
        ]);
      });
      continue;
    }
    const weight = partWeight(part);
    if (used > 0 && used + weight > ASSISTANT_SLICE_CHARS) emit();
    bucket.push(part);
    used += weight;
  }
  emit();
  if (slices.length === 0) return [wholeSlice(entry)];
  if (slices.length === 1) {
    return [
      {
        key: entry.id,
        parts: slices[0],
        showTail: true,
        continued: false,
      },
    ];
  }
  return slices.map((parts, i) => ({
    key: `${entry.id}#${i}`,
    parts,
    showTail: i === slices.length - 1,
    continued: i > 0,
  }));
};
