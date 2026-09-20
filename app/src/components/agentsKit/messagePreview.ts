// Preview-rail copy + active-tick helpers. Semantics from beUI
// `message-scroller` / `preview-rail` (MIT) — see AGENTS_KIT_PROVENANCE.md.

import type { MessageEntry } from '../../zeron/protocol/types';

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
  return collapseMessageText(
    entry.parts
      .filter(
        (p): p is { kind: 'text'; id: string; text: string } =>
          p.kind === 'text',
      )
      .map(p => p.text)
      .join(' '),
  );
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
  },
): RailItem[] {
  return entries.map((entry, index) => {
    const assistantResponse =
      entry.role === 'user'
        ? entries
            .slice(index + 1)
            .find(candidate => candidate.role === 'assistant')
        : undefined;
    const preview = getMessagePreview(
      entryPreviewText(entry),
      assistantResponse ? entryPreviewText(assistantResponse) : undefined,
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

export function pickActiveRailId(opts: {
  itemIds: string[];
  offset: number;
  viewportHeight: number;
  contentHeight: number;
  viewableIds: string[];
  threshold?: number;
}): string {
  const { itemIds, viewableIds } = opts;
  if (itemIds.length === 0) return '';
  const threshold = opts.threshold ?? FOLLOW_THRESHOLD;
  if (opts.offset <= threshold) return itemIds[0] ?? '';
  const distanceFromEnd =
    opts.contentHeight - opts.offset - opts.viewportHeight;
  if (distanceFromEnd <= threshold) return itemIds[itemIds.length - 1] ?? '';
  if (viewableIds.length === 0) return itemIds[0] ?? '';
  return viewableIds[Math.floor(viewableIds.length / 2)] ?? itemIds[0] ?? '';
}
