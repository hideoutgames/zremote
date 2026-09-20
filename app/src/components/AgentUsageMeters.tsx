// Shared usage-meter rows (desktop thresholds: indigo → amber ≥80% →
// red ≥95%, compact reset time). Used by Agent Accounts settings and the
// session Usage sheet.

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { formatReset, usageLevel } from '../zeron/accounts/accounts';
import type { AgentUsageWindow } from '../zeron/protocol/types';
import { useTheme } from '../theme';

const usageColor = (
  level: ReturnType<typeof usageLevel>,
  theme: { accent: string; danger: string },
): string =>
  level === 'critical'
    ? theme.danger
    : level === 'warn'
    ? '#E5A50A'
    : '#6366F1';

export function AgentUsageMeters({ windows }: { windows: AgentUsageWindow[] }) {
  const theme = useTheme();
  const now = Date.now();
  return (
    <>
      {windows.map((w, i) => {
        const level = usageLevel(w.usedFraction);
        return (
          <View key={i} style={styles.meterRow} testID="agent-usage-meter">
            <Text
              style={[styles.meterLabel, { color: theme.textSecondary }]}
              maxFontSizeMultiplier={1.6}
            >
              {w.label}
            </Text>
            <View
              style={[styles.meterTrack, { backgroundColor: theme.border }]}
            >
              <View
                style={[
                  styles.meterFill,
                  {
                    width: `${Math.round(w.usedFraction * 100)}%`,
                    backgroundColor: usageColor(level, theme),
                  },
                ]}
              />
            </View>
            <Text style={[styles.meterPct, { color: theme.textSecondary }]}>
              {`${Math.round(w.usedFraction * 100)}%`}
            </Text>
            <Text style={[styles.meterReset, { color: theme.textSecondary }]}>
              {formatReset(w.resetsAt, now) ?? ''}
            </Text>
          </View>
        );
      })}
    </>
  );
}

const styles = StyleSheet.create({
  meterRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  meterLabel: { width: 56, fontSize: 11 },
  meterTrack: { flex: 1, height: 5, borderRadius: 3, overflow: 'hidden' },
  meterFill: { height: 5, borderRadius: 3 },
  meterPct: { width: 36, fontSize: 11, textAlign: 'right' },
  meterReset: { fontSize: 10, width: 90 },
});
