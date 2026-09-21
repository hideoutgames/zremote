// Conservative cleanup validator. The system prompt is not trusted to
// prevent rewriting: retained words must stay an ordered subsequence of
// the input after whitespace/punctuation normalization.

const FILLER = new Set([
  'um',
  'uh',
  'erm',
  'hmm',
  'ah',
  'huh',
  'mhm',
  'mm',
  'mmm',
  'uhh',
  'umm',
  'er',
  'uhhuh',
]);

const EDGE_PUNCT = /^[.,!?;:'"()[\]{}<>“”‘’]+|[.,!?;:'"()[\]{}<>“”‘’]+$/g;

export const tokenizeVoiceText = (text: string): string[] =>
  text
    .trim()
    .split(/\s+/)
    .map(tok => tok.replace(EDGE_PUNCT, ''))
    .filter(tok => tok.length > 0);

const hasMeaningfulContent = (tokens: readonly string[]): boolean =>
  tokens.some(tok => !FILLER.has(tok.toLowerCase()));

const isSubsequence = (
  input: readonly string[],
  output: readonly string[],
): boolean => {
  let i = 0;
  for (const word of output) {
    while (i < input.length && input[i] !== word) i += 1;
    if (i >= input.length) return false;
    i += 1;
  }
  return true;
};

const looksLikeCommentary = (text: string): boolean => {
  const trimmed = text.trim();
  if (trimmed.includes('```')) return true;
  if (/^\s*(output|input|cleaned|transcript)\s*:/i.test(trimmed)) return true;
  if (/here(?:'s| is) (?:the )?(?:cleaned|corrected)/i.test(trimmed))
    return true;
  return false;
};

export type CleanupValidation =
  | { ok: true; text: string }
  | { ok: false; reason: 'empty' | 'added' | 'commentary' | 'truncated' };

export const validateCleanupOutput = (
  input: string,
  output: string,
  opts?: { truncated?: boolean },
): CleanupValidation => {
  if (opts?.truncated === true) return { ok: false, reason: 'truncated' };
  if (looksLikeCommentary(output)) return { ok: false, reason: 'commentary' };

  const inTokens = tokenizeVoiceText(input);
  const outTokens = tokenizeVoiceText(output);

  if (outTokens.length === 0) {
    if (!hasMeaningfulContent(inTokens)) return { ok: true, text: '' };
    return { ok: false, reason: 'empty' };
  }

  if (!isSubsequence(inTokens, outTokens)) {
    return { ok: false, reason: 'added' };
  }

  return { ok: true, text: output.trim() };
};
