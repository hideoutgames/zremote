// Unified-diff parser — pure. Splits a git-format patch into files, hunks,
// and typed lines; handles adds, deletes, renames, binary markers, and the
// "\ No newline at end of file" sentinel.

export type DiffLineKind = 'context' | 'add' | 'del' | 'meta';

export interface DiffLine {
  kind: DiffLineKind;
  text: string;
  /** Line number on each side; undefined on meta lines. */
  oldNo?: number;
  newNo?: number;
}

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  header: string;
  lines: DiffLine[];
}

export interface ParsedFileDiff {
  oldPath?: string;
  newPath?: string;
  status: 'added' | 'deleted' | 'modified' | 'renamed' | 'binary';
  hunks: DiffHunk[];
}

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/;

export const parseUnified = (patch: string): ParsedFileDiff[] => {
  const files: ParsedFileDiff[] = [];
  let file: ParsedFileDiff | undefined;
  let hunk: DiffHunk | undefined;
  let oldNo = 0;
  let newNo = 0;

  const pushLine = (kind: DiffLineKind, text: string): void => {
    if (hunk === undefined) return;
    const line: DiffLine = { kind, text };
    if (kind === 'context') {
      line.oldNo = oldNo++;
      line.newNo = newNo++;
    } else if (kind === 'del') {
      line.oldNo = oldNo++;
    } else if (kind === 'add') {
      line.newNo = newNo++;
    }
    hunk.lines.push(line);
  };

  for (const raw of patch.split('\n')) {
    if (raw.startsWith('diff --git ')) {
      file = { status: 'modified', hunks: [] };
      files.push(file);
      hunk = undefined;
      continue;
    }
    if (file === undefined) continue;
    if (raw.startsWith('new file mode')) {
      file.status = 'added';
      continue;
    }
    if (raw.startsWith('deleted file mode')) {
      file.status = 'deleted';
      continue;
    }
    if (raw.startsWith('rename from ')) {
      file.status = 'renamed';
      file.oldPath = raw.slice('rename from '.length);
      continue;
    }
    if (raw.startsWith('rename to ')) {
      file.newPath = raw.slice('rename to '.length);
      continue;
    }
    if (raw.startsWith('Binary files ') || raw.startsWith('GIT binary patch')) {
      file.status = 'binary';
      continue;
    }
    if (raw.startsWith('--- ')) {
      const p = raw.slice(4);
      if (p !== '/dev/null') file.oldPath = stripPrefix(p);
      continue;
    }
    if (raw.startsWith('+++ ')) {
      const p = raw.slice(4);
      if (p !== '/dev/null') file.newPath = stripPrefix(p);
      continue;
    }
    const m = HUNK_RE.exec(raw);
    if (m !== null) {
      hunk = {
        oldStart: Number(m[1]),
        oldLines: m[2] === undefined ? 1 : Number(m[2]),
        newStart: Number(m[3]),
        newLines: m[4] === undefined ? 1 : Number(m[4]),
        header: m[5].trim(),
        lines: [],
      };
      file.hunks.push(hunk);
      oldNo = hunk.oldStart;
      newNo = hunk.newStart;
      continue;
    }
    if (hunk === undefined) continue;
    if (raw === '\\ No newline at end of file') {
      pushLine('meta', raw);
    } else if (raw.startsWith('+')) {
      pushLine('add', raw.slice(1));
    } else if (raw.startsWith('-')) {
      pushLine('del', raw.slice(1));
    } else if (raw.startsWith(' ')) {
      pushLine('context', raw.slice(1));
    } else if (raw === '') {
      // Blank context lines inside a hunk arrive as ''; a trailing '' from
      // split() at end-of-patch is an artifact — only accept while the hunk
      // still expects lines.
      const remaining =
        hunk.lines.filter(l => l.kind === 'context' || l.kind === 'del')
          .length < hunk.oldLines ||
        hunk.lines.filter(l => l.kind === 'context' || l.kind === 'add')
          .length < hunk.newLines;
      if (remaining) pushLine('context', '');
    }
  }
  return files;
};

const stripPrefix = (p: string): string =>
  p.startsWith('a/') || p.startsWith('b/') ? p.slice(2) : p;
