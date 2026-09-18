// FileDiff — monospace, line-numbered, color-coded unified-diff view.
// Semantics ported from beui `file-diff` / beautiful-ui `diff-table`
// (see docs/AGENTS_KIT_PROVENANCE.md): old/new gutter columns, hunk headers,
// +/- tinted rows, meta rows (no-newline marker) uncoloured.

import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../theme';
import type { ParsedFileDiff } from '../../zeron/diff/parseUnified';

export function FileDiff({ file }: { file: ParsedFileDiff }) {
  const theme = useTheme();
  return (
    <ScrollView horizontal style={styles.scroll}>
      <View>
        {file.hunks.map((h, i) => (
          <View key={i}>
            <Text
              style={[styles.hunkHeader, { color: theme.textSecondary }]}
              maxFontSizeMultiplier={1.6}
            >
              {`@@ -${h.oldStart},${h.oldLines} +${h.newStart},${
                h.newLines
              } @@${h.header === '' ? '' : ` ${h.header}`}`}
            </Text>
            {h.lines.map((l, j) => (
              <View
                key={j}
                style={[
                  styles.line,
                  l.kind === 'add'
                    ? { backgroundColor: theme.diffAddBackground }
                    : l.kind === 'del'
                    ? { backgroundColor: theme.diffDelBackground }
                    : undefined,
                ]}
              >
                <Text style={[styles.gutter, { color: theme.textSecondary }]}>
                  {l.oldNo ?? ''}
                </Text>
                <Text style={[styles.gutter, { color: theme.textSecondary }]}>
                  {l.newNo ?? ''}
                </Text>
                <Text
                  style={[
                    styles.code,
                    {
                      color:
                        l.kind === 'add'
                          ? theme.diffAddText
                          : l.kind === 'del'
                          ? theme.diffDelText
                          : theme.text,
                    },
                  ]}
                >
                  {l.kind === 'add' ? '+' : l.kind === 'del' ? '-' : ' '}
                  {l.text}
                </Text>
              </View>
            ))}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 0 },
  hunkHeader: {
    fontFamily: 'monospace',
    fontSize: 11,
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  line: { flexDirection: 'row', paddingHorizontal: 4 },
  gutter: {
    fontFamily: 'monospace',
    fontSize: 11,
    width: 40,
    textAlign: 'right',
    paddingRight: 6,
  },
  code: { fontFamily: 'monospace', fontSize: 12 },
});
