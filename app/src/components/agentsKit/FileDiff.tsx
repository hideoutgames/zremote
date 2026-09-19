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
    <ScrollView
      horizontal
      style={styles.scroll}
      contentContainerStyle={styles.scrollContent}
    >
      <View style={styles.body}>
        {file.hunks.map((h, i) => (
          <View key={i} style={styles.hunk}>
            <View
              style={[
                styles.hunkRule,
                {
                  borderTopColor: theme.border,
                  backgroundColor: theme.surface,
                },
              ]}
            >
              {h.header !== '' ? (
                <Text
                  style={[styles.hunkHeader, { color: theme.textSecondary }]}
                  maxFontSizeMultiplier={1.6}
                >
                  {h.header}
                </Text>
              ) : null}
            </View>
            {h.lines.map((l, j) => {
              const add = l.kind === 'add';
              const del = l.kind === 'del';
              return (
                <View
                  key={j}
                  style={[
                    styles.line,
                    add
                      ? { backgroundColor: theme.diffAddBackground }
                      : del
                      ? { backgroundColor: theme.diffDelBackground }
                      : undefined,
                  ]}
                >
                  <View
                    style={[
                      styles.rail,
                      {
                        backgroundColor: add
                          ? theme.diffAddText
                          : del
                          ? theme.diffDelText
                          : 'transparent',
                      },
                    ]}
                  />
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
                        color: add
                          ? theme.diffAddText
                          : del
                          ? theme.diffDelText
                          : theme.text,
                      },
                    ]}
                  >
                    {add ? '+' : del ? '-' : ' '}
                    {l.text}
                  </Text>
                </View>
              );
            })}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { alignSelf: 'stretch', width: '100%' },
  scrollContent: { width: '100%', minWidth: '100%', flexGrow: 1 },
  body: { minWidth: '100%' },
  hunk: { minWidth: '100%' },
  hunkRule: {
    borderTopWidth: StyleSheet.hairlineWidth,
    minHeight: 8,
    justifyContent: 'center',
    minWidth: '100%',
  },
  hunkHeader: {
    fontFamily: 'monospace',
    fontSize: 13,
    paddingVertical: 4,
    paddingHorizontal: 12,
  },
  line: {
    flexDirection: 'row',
    alignItems: 'stretch',
    paddingRight: 8,
    minWidth: '100%',
  },
  rail: { width: 3 },
  gutter: {
    fontFamily: 'monospace',
    fontSize: 13,
    width: 36,
    textAlign: 'right',
    paddingRight: 8,
    fontVariant: ['tabular-nums'],
  },
  code: { fontFamily: 'monospace', fontSize: 14, flexGrow: 1, flexShrink: 0 },
});
