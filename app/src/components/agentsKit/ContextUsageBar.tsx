// Ported from Agents Kit components/ai-elements/context.tsx (Apache-2.0,
// Vercel AI Elements) — the context-window usage meter. A thin bar under the
// session header; rendered only when the doc's meta carries contextUsage
// (never invented).

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { ContextUsage } from '../../zeron/protocol/types';
import { useTheme } from '../../theme';

export const ContextUsageBar = React.memo(function ({
  usage,
}: {
  usage: ContextUsage | undefined;
}) {
  const theme = useTheme();
  if (usage === undefined || usage.tokens == null || usage.window == null)
    return null;
  const ratio = Math.max(0, Math.min(1, usage.tokens / usage.window));
  return (
    <View style={styles.wrap}>
      <View style={[styles.track, { backgroundColor: theme.border }]}>
        <View
          style={[
            styles.fill,
            {
              backgroundColor:
                ratio > 0.9 ? theme.danger : theme.indicatorWorking,
              width: `${Math.round(ratio * 100)}%`,
            },
          ]}
        />
      </View>
      <Text style={[styles.label, { color: theme.textSecondary }]}>
        {`${usage.tokens.toLocaleString()} / ${usage.window.toLocaleString()}`}
      </Text>
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 4,
  },
  track: {
    flex: 1,
    height: 3,
    borderRadius: 2,
    overflow: 'hidden',
  },
  fill: { height: 3, borderRadius: 2 },
  label: { fontSize: 11, fontVariant: ['tabular-nums'] },
});
