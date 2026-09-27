// Turn a local cleanup-model completion into the transcript edit the
// validator can accept. Small instruct models wrap the edit in labels,
// quotes, think tags, or a copied example; llama.rn also reports
// `truncated` on completions that stopped cleanly. Those both used to
// discard every rewrite and leave the raw transcript in place.

import { validateCleanupOutput } from './validator';

const THINK = /<think\b[^>]*>[\s\S]*?<\/think>/gi;
const SPECIAL = /<\|[^|>\n]{1,80}\|>/g;
const FENCE = /^```[a-z0-9]*\n?([\s\S]*?)```$/i;
const LABEL =
  /^(?:output|input|cleaned(?:\s+transcript)?|transcript|result)\s*:\s*/i;
const POLITE =
  /^(?:sure[,!]?\s+)?here(?:'s| is)\s+(?:the\s+)?(?:cleaned\s+|corrected\s+)?(?:transcript|text|version)\s*[:\-–]?\s*/i;

const unwrapQuotes = (text: string): string => {
  if (text.length < 2) return text;
  const pairs: Array<[string, string]> = [
    ['"', '"'],
    ["'", "'"],
    ['“', '”'],
    ['‘', '’'],
  ];
  for (const [open, close] of pairs) {
    if (text.startsWith(open) && text.endsWith(close)) {
      return text.slice(open.length, -close.length).trim();
    }
  }
  return text;
};

export const normalizeCleanupText = (raw: string): string => {
  let text = raw.replace(THINK, ' ').replace(SPECIAL, ' ');
  text = text.trim();
  const fenced = text.match(FENCE);
  if (fenced?.[1] !== undefined) text = fenced[1].trim();
  if (!text.includes('\n')) {
    const arrow = text.match(/^(?:.+?)(?:→|->)\s*(.+)$/);
    if (arrow?.[1] !== undefined && arrow[1].trim() !== '') {
      text = arrow[1].trim();
    }
  }
  text = text.replace(LABEL, '').replace(POLITE, '').trim();
  text = unwrapQuotes(text);
  return text
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

export const chooseCleanupText = (
  transcript: string,
  parts: { content?: string; text?: string },
): string => {
  const normalized = [parts.content, parts.text]
    .filter((part): part is string => typeof part === 'string')
    .map(part => normalizeCleanupText(part));
  const ordered = [
    ...normalized.filter(part => part !== ''),
    ...normalized.filter(part => part === ''),
  ];
  for (const option of ordered) {
    const checked = validateCleanupOutput(transcript, option);
    if (checked.ok) return checked.text;
  }
  return normalized.find(part => part !== '') ?? '';
};

const stoppedOnWord = (value: unknown): boolean => {
  if (value === true || value === 1) return true;
  return typeof value === 'string' && value !== '';
};

const stoppedOnEos = (value: unknown): boolean => value === true || value === 1;

/**
 * llama.rn sets `truncated` when the prompt was cut to fit the context,
 * and older builds also set it on completions that already stopped on
 * EOS or a stop word. Only a real cutoff should discard the edit.
 */
export const cleanupResultTruncated = (result: {
  stopped_limit?: number | boolean;
  context_full?: boolean;
  interrupted?: boolean;
  truncated?: boolean;
  stopped_eos?: boolean | number;
  stopped_word?: boolean | number | string;
}): boolean => {
  const hitLimit =
    result.stopped_limit === true ||
    (typeof result.stopped_limit === 'number' && result.stopped_limit > 0);
  if (hitLimit || result.context_full === true || result.interrupted === true) {
    return true;
  }
  if (stoppedOnEos(result.stopped_eos) || stoppedOnWord(result.stopped_word)) {
    return false;
  }
  return result.truncated === true;
};
