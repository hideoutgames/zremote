// Range-safe draft splices for local voice. Cleanup never rebuilds the
// whole draft from an old snapshot.

export interface VoiceInsertionRange {
  start: number;
  end: number;
  raw: string;
}

export const spliceVoiceText = (
  draft: string,
  index: number,
  text: string,
): { text: string; range: VoiceInsertionRange } => {
  const start = Math.max(0, Math.min(index, draft.length));
  const next = `${draft.slice(0, start)}${text}${draft.slice(start)}`;
  return {
    text: next,
    range: { start, end: start + text.length, raw: text },
  };
};

export const replaceVoiceRange = (
  draft: string,
  range: VoiceInsertionRange,
  replacement: string,
): string | undefined => {
  if (draft.slice(range.start, range.end) !== range.raw) return undefined;
  return `${draft.slice(0, range.start)}${replacement}${draft.slice(
    range.end,
  )}`;
};

export const restoreVoiceRange = (
  draft: string,
  start: number,
  end: number,
  expected: string,
  original: string,
): string | undefined => {
  if (draft.slice(start, end) !== expected) return undefined;
  return `${draft.slice(0, start)}${original}${draft.slice(end)}`;
};
