// Display-only mend for half-streamed inline markdown — port of
// _ref/zeron/crates/ui/src/markdown/mend.rs `close_hanging`. Applied to the
// live last text part so hanging `**` / `` ` `` / links do not reflow when
// the closer arrives. The canonical source is untouched.

export const PENDING_LINK_URL = 'zeron:pending-link';

type OpenDelim = { ch: string; len: number; pos: number };

const isWs = (c: string): boolean => /\s/u.test(c);
const isAlnum = (c: string | undefined): boolean =>
  c !== undefined && /[\p{L}\p{N}]/u.test(c);

const runLen = (cs: string[], i: number): number => {
  const c = cs[i];
  let n = 0;
  while (i + n < cs.length && cs[i + n] === c) n += 1;
  return n;
};

const delim = (
  delims: OpenDelim[],
  cs: string[],
  c: string,
  run: number,
  i: number,
  lastContent: { v: number | undefined },
): void => {
  const end = i + run;
  if (c === '~' && run > 2) {
    lastContent.v = end - 1;
    return;
  }
  const prev = i > 0 ? cs[i - 1] : undefined;
  const next = cs[end];
  if (
    isAlnum(prev) &&
    isAlnum(next) &&
    (c === '_' || (c === '*' && run === 1))
  ) {
    lastContent.v = end - 1;
    return;
  }
  const canClose = prev !== undefined && !isWs(prev);
  const canOpen = next !== undefined && !isWs(next);
  let rest = run;
  if (canClose) {
    let k = -1;
    for (let j = delims.length - 1; j >= 0; j--) {
      if (delims[j].ch === c) {
        k = j;
        break;
      }
    }
    if (k >= 0) {
      const take = Math.min(rest, delims[k].len);
      delims[k].len -= take;
      rest -= take;
      const keep = delims[k].len === 0 ? k : k + 1;
      delims.length = keep;
    }
  }
  if (rest > 0) {
    if (canOpen && (c !== '~' || rest === 2)) {
      delims.push({ ch: c, len: rest, pos: end });
    } else {
      lastContent.v = end - 1;
    }
  }
};

const setextPartial = (text: string): boolean => {
  const nl = text.lastIndexOf('\n');
  if (nl < 0) return false;
  const last = text.slice(nl + 1);
  const trimmed = last.trimStart();
  const underline = (c: string): boolean =>
    trimmed.length > 0 &&
    trimmed.length <= 2 &&
    [...trimmed].every(x => x === c);
  if (!underline('-') && !underline('=')) return false;
  const above = text.slice(0, nl);
  const lines = above.split('\n');
  const prev = lines[lines.length - 1];
  return prev !== undefined && prev.trim() !== '';
};

/** Repair hanging inline markers. Returns undefined when nothing hangs. */
export const closeHanging = (text: string): string | undefined => {
  const cs = [...text];
  const n = cs.length;
  const at = (i: number): string | undefined => cs[i];

  const delims: OpenDelim[] = [];
  const brackets: number[] = [];
  let code: { ticks: number; cpos: number } | undefined;
  const lastContent: { v: number | undefined } = { v: undefined };
  let pendingUrl: number | undefined;

  let i = 0;
  while (i < n) {
    const c = cs[i];
    if (code === undefined && c === '\\') {
      if (i + 1 < n) lastContent.v = i + 1;
      i += 2;
      continue;
    }
    if (c === '`') {
      const run = runLen(cs, i);
      if (code !== undefined && run === code.ticks) code = undefined;
      else if (code !== undefined) lastContent.v = i + run - 1;
      else code = { ticks: run, cpos: i + run };
      i += run;
      continue;
    }
    if (code !== undefined) {
      lastContent.v = i;
      i += 1;
      continue;
    }
    if (c === '*' || c === '_' || c === '~') {
      const run = runLen(cs, i);
      delim(delims, cs, c, run, i, lastContent);
      i += run;
      continue;
    }
    if (c === '[') {
      brackets.push(i);
      i += 1;
      continue;
    }
    if (c === ']') {
      const open = brackets.pop();
      if (open !== undefined) {
        for (let d = delims.length - 1; d >= 0; d--) {
          if (delims[d].pos >= open) delims.splice(d, 1);
        }
        if (at(i + 1) === '(') {
          let j = i + 2;
          let depth = 0;
          for (;;) {
            const ch = at(j);
            if (ch === '(') depth += 1;
            else if (ch === ')' && depth === 0) break;
            else if (ch === ')') depth -= 1;
            else if (ch === undefined) {
              pendingUrl = i;
              break;
            }
            j += 1;
          }
          if (pendingUrl !== undefined) break;
          lastContent.v = j;
          i = j + 1;
          continue;
        }
      }
      lastContent.v = i;
      i += 1;
      continue;
    }
    if (isWs(c)) {
      i += 1;
      continue;
    }
    lastContent.v = i;
    i += 1;
  }

  if (pendingUrl !== undefined) {
    const prefix = cs.slice(0, pendingUrl).join('');
    return `${prefix}](${PENDING_LINK_URL})`;
  }

  const pending: { pos: number; s: string }[] = [];
  if (
    code !== undefined &&
    lastContent.v !== undefined &&
    lastContent.v >= code.cpos
  ) {
    pending.push({ pos: code.cpos, s: '`'.repeat(code.ticks) });
  }
  for (const d of delims) {
    if (lastContent.v !== undefined && lastContent.v >= d.pos) {
      pending.push({ pos: d.pos, s: d.ch.repeat(d.len) });
    }
  }
  const openBracket = brackets[brackets.length - 1];
  if (
    openBracket !== undefined &&
    lastContent.v !== undefined &&
    lastContent.v > openBracket
  ) {
    pending.push({ pos: openBracket, s: `](${PENDING_LINK_URL})` });
  }
  pending.sort((a, b) => b.pos - a.pos);
  const closers = pending.map(p => p.s).join('');
  const setext = setextPartial(text);

  if (closers === '' && !setext) return undefined;
  if (setext) {
    const nl = text.lastIndexOf('\n');
    if (nl >= 0 && closers !== '') {
      return `${text.slice(0, nl)}${closers}${text.slice(nl)}\u200B`;
    }
    return `${text}\u200B`;
  }
  const end = text.trimEnd().length;
  return `${text.slice(0, end)}${closers}${text.slice(end)}`;
};

/** Streaming display source: mended when hanging, otherwise the original. */
export const mendMarkdown = (text: string): string =>
  closeHanging(text) ?? text;
