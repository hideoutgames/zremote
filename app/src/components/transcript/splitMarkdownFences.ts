export type MarkdownSegment =
  | { kind: 'prose'; text: string }
  | { kind: 'code'; lang: string; text: string; closed: boolean };

const OPEN = /^(```|~~~)(.*)$/;

const isFenceClose = (line: string, fence: string): boolean => {
  if (line === fence) return true;
  return line.startsWith(fence) && line.slice(fence.length).trim() === '';
};

/** Split markdown into prose vs fenced code so we can overlay a copy button
 *  on each fence. Unclosed fences (streaming) stay `closed: false`. */
export const splitMarkdownFences = (source: string): MarkdownSegment[] => {
  const lines = source.split('\n');
  const out: MarkdownSegment[] = [];
  let i = 0;
  let prose: string[] = [];
  const flushProse = () => {
    if (prose.length === 0) return;
    const text = prose.join('\n');
    prose = [];
    if (text === '') return;
    out.push({ kind: 'prose', text });
  };
  while (i < lines.length) {
    const open = OPEN.exec(lines[i]);
    if (open) {
      flushProse();
      const fence = open[1];
      const lang = open[2].trim();
      i += 1;
      const body: string[] = [];
      let closed = false;
      while (i < lines.length) {
        if (isFenceClose(lines[i], fence)) {
          closed = true;
          i += 1;
          break;
        }
        body.push(lines[i]);
        i += 1;
      }
      out.push({ kind: 'code', lang, text: body.join('\n'), closed });
      continue;
    }
    prose.push(lines[i]);
    i += 1;
  }
  flushProse();
  return out;
};
