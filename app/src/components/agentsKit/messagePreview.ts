// Preview-rail copy + active-tick helpers. Semantics from beUI
// `message-scroller` / `preview-rail` (MIT) — see AGENTS_KIT_PROVENANCE.md.

import type { MessageEntry } from '../../zeron/protocol/types';
import { userMessageRailText } from '../../zeron/protocol/messages';

export const PREVIEW_TITLE_LENGTH = 56;
export const PREVIEW_DESCRIPTION_LENGTH = 88;
export const FOLLOW_THRESHOLD = 56;
export const RAIL_ITEM_SIZE = 14;

export type RailItem = {
  id: string;
  label: string;
  description?: string;
  ariaLabel: string;
};

export function collapseMessageText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function entryPreviewText(entry: MessageEntry): string {
  const raw = entry.parts
    .filter(
      (p): p is { kind: 'text'; id: string; text: string } => p.kind === 'text',
    )
    .map(p => p.text)
    .join(' ');
  const text = entry.role === 'user' ? userMessageRailText(raw) : raw;
  return collapseMessageText(text);
}

export function truncateMessageText(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const excerpt = text.slice(0, limit);
  const boundary = excerpt.lastIndexOf(' ');
  return `${excerpt
    .slice(0, boundary > limit * 0.65 ? boundary : limit)
    .trim()}…`;
}

export function getMessagePreview(
  text: string,
  assistantText: string | undefined,
  emptyLabel: string,
): { label: string; description?: string } {
  if (!text) {
    return { label: emptyLabel, description: undefined };
  }

  if (text.length <= PREVIEW_TITLE_LENGTH) {
    return {
      label: text,
      description: assistantText
        ? truncateMessageText(assistantText, PREVIEW_DESCRIPTION_LENGTH)
        : undefined,
    };
  }

  const titleExcerpt = text.slice(0, PREVIEW_TITLE_LENGTH);
  const titleBoundary = titleExcerpt.lastIndexOf(' ');
  const titleEnd =
    titleBoundary > PREVIEW_TITLE_LENGTH * 0.65
      ? titleBoundary
      : PREVIEW_TITLE_LENGTH;
  const label = `${text.slice(0, titleEnd).trim()}…`;
  const responseText = assistantText ?? text.slice(titleEnd).trim();
  return {
    label,
    description: responseText
      ? truncateMessageText(responseText, PREVIEW_DESCRIPTION_LENGTH)
      : undefined,
  };
}

export function buildRailItems(
  entries: MessageEntry[],
  opts: {
    emptyLabel: string;
    goToLabel: (role: string, index: number, total: number) => string;
    /** Text-extraction hook — lets callers cache per-entry collapse work. */
    previewText?: (entry: MessageEntry) => string;
  },
): RailItem[] {
  const textFor = opts.previewText ?? entryPreviewText;
  // Index of the next assistant entry after each index, in one pass.
  const nextAssistant = new Array<number>(entries.length);
  let assistantAt = -1;
  for (let i = entries.length - 1; i >= 0; i--) {
    nextAssistant[i] = assistantAt;
    if (entries[i]?.role === 'assistant') assistantAt = i;
  }
  return entries.map((entry, index) => {
    const responseIndex = entry.role === 'user' ? nextAssistant[index] : -1;
    const assistantResponse =
      responseIndex >= 0 ? entries[responseIndex] : undefined;
    const preview = getMessagePreview(
      textFor(entry),
      assistantResponse ? textFor(assistantResponse) : undefined,
      opts.emptyLabel,
    );
    return {
      id: entry.id,
      label: preview.label,
      description: preview.description,
      ariaLabel: opts.goToLabel(entry.role, index + 1, entries.length),
    };
  });
}

export function tickScale(distance: number): number {
  if (distance === 0) return 1;
  if (distance === 1) return 0.68;
  if (distance === 2) return 0.44;
  return 0.25;
}

export function railItemSize(
  count: number,
  railHeight: number,
  base = RAIL_ITEM_SIZE,
): number {
  if (count <= 0 || railHeight <= 0) return base;
  const needed = count * base;
  if (needed <= railHeight) return base;
  return railHeight / count;
}

/** Map a Y offset on the rail column to a tick index. `stackTop` is the
 *  empty padding above a short (uncompressed) stack. */
export function railIndexAtY(
  y: number,
  count: number,
  itemSize: number,
  stackTop: number,
): number {
  if (count <= 0) return 0;
  if (itemSize <= 0) return 0;
  const index = Math.floor((y - stackTop) / itemSize);
  if (index < 0) return 0;
  if (index > count - 1) return count - 1;
  return index;
}

/** Map a Y offset on the rail column to 0..1 stack progress (scrollbar). */
export function railProgressAtY(
  y: number,
  count: number,
  itemSize: number,
  stackTop: number,
): number {
  if (count <= 0 || itemSize <= 0) return 0;
  const span = count * itemSize;
  const progress = (y - stackTop) / span;
  if (progress <= 0) return 0;
  if (progress >= 1) return 1;
  return progress;
}

/** Convert a touch into track-local Y. `locationY` is the source of truth
 *  (same as EffortSlider). Window `pageY` minus a measured origin is the
 *  fallback when locationY is missing. Unmeasured pageY must not be treated
 *  as track-local — that maps first touches to the live edge. */
export function railYFromPage(
  pageY: number | undefined,
  locationY: number | undefined,
  originY: number | null,
): number {
  if (typeof locationY === 'number') return locationY;
  if (typeof pageY !== 'number') return 0;
  if (originY == null) return 0;
  return pageY - originY;
}

/** Pick the rail tick matching scroll position — proportional, the inverse
 *  of the scrub mapping (`offsetForRailIndex`), so the highlight tracks the
 *  same position a scrub writes. Edge thresholds pin the first/last tick
 *  like a scrollbar. */
export function pickActiveRailId(opts: {
  itemIds: string[];
  offset: number;
  viewportHeight: number;
  contentHeight: number;
  threshold?: number;
}): string {
  const { itemIds } = opts;
  if (itemIds.length === 0) return '';
  const threshold = opts.threshold ?? FOLLOW_THRESHOLD;
  if (opts.offset <= threshold) return itemIds[0] ?? '';
  const maxOffset = opts.contentHeight - opts.viewportHeight;
  if (maxOffset - opts.offset <= threshold)
    return itemIds[itemIds.length - 1] ?? '';
  if (maxOffset <= 0) return itemIds[0] ?? '';
  const progress = opts.offset / maxOffset;
  return (
    itemIds[Math.round(progress * (itemIds.length - 1))] ?? itemIds[0] ?? ''
  );
}
