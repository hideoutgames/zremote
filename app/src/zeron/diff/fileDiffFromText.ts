import type { ParsedFileDiff } from './parseUnified';

/** Build a one-hunk file diff from old/new sides when we don't have a
 * unified patch. Identical files yield an empty hunk list. */
export const fileDiffFromText = (
  path: string,
  oldText: string | undefined,
  newText: string | undefined,
): ParsedFileDiff => {
  const oldLines = (oldText ?? '').split('\n');
  const newLines = (newText ?? '').split('\n');
  const emptyOld = oldText === undefined || oldText === '';
  const emptyNew = newText === undefined || newText === '';
  if (emptyOld && emptyNew)
    return { newPath: path, status: 'modified', hunks: [] };
  if (oldText === newText)
    return { newPath: path, status: 'modified', hunks: [] };

  const status: ParsedFileDiff['status'] = emptyOld
    ? 'added'
    : emptyNew
    ? 'deleted'
    : 'modified';
  const lines = [
    ...oldLines.map((text, i) => ({
      kind: 'del' as const,
      text,
      oldNo: i + 1,
    })),
    ...newLines.map((text, i) => ({
      kind: 'add' as const,
      text,
      newNo: i + 1,
    })),
  ];
  return {
    oldPath: emptyOld ? undefined : path,
    newPath: emptyNew ? undefined : path,
    status,
    hunks: [
      {
        oldStart: 1,
        oldLines: oldLines.length,
        newStart: 1,
        newLines: newLines.length,
        header: '',
        lines,
      },
    ],
  };
};
