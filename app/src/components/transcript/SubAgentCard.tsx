import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Icon } from '../Icon';
import { ShimmerText } from '../ShimmerText';
import { useTheme } from '../../theme';
import { t } from '../../i18n/strings';
import type { SubagentView } from './detectSubagent';
import type { SubagentStatus } from '../../zeron/protocol/types';

const stateLabel = (state: SubagentStatus): string => {
  switch (state) {
    case 'running':
      return t('session.working');
    case 'failed':
      return t('session.subagents.failed');
    default:
      return t('common.done');
  }
};

export function SubAgentCard({
  view,
  embedded = false,
}: {
  view: SubagentView;
  embedded?: boolean;
}) {
  const theme = useTheme();
  const state = stateLabel(view.state);
  const subtitle =
    view.agentName !== '' ? `${state} · ${view.agentName}` : state;
  const [width, setWidth] = useState(160);
  const running = view.state === 'running';
  const dot = running
    ? theme.indicatorWorking
    : view.state === 'failed'
    ? theme.danger
    : theme.textSecondary;
  return (
    <View
      accessibilityRole="summary"
      accessibilityLabel={`${view.title}. ${subtitle}`}
      style={[
        styles.card,
        embedded ? styles.embedded : undefined,
        embedded
          ? undefined
          : {
              backgroundColor: theme.cardBackground,
              borderColor: theme.border,
            },
      ]}
    >
      <View style={[styles.dot, { backgroundColor: dot }]} />
      <View
        style={styles.body}
        onLayout={e => {
          const w = Math.round(e.nativeEvent.layout.width);
          if (w > 0) setWidth(w);
        }}
      >
        <Text style={[styles.title, { color: theme.text }]} numberOfLines={2}>
          {view.title}
        </Text>
        <View testID={`subagent-status-${view.id}`}>
          {running ? (
            <ShimmerText
              text={subtitle}
              width={width}
              fontSize={15}
              fontWeight="400"
              maxLines={1}
              align="left"
              baseColor={theme.textSecondary}
              highlightColor={theme.text}
            />
          ) : (
            <Text
              style={[styles.subtitle, { color: theme.textSecondary }]}
              numberOfLines={1}
            >
              {subtitle}
            </Text>
          )}
        </View>
      </View>
      <Icon name="chevron.right" size={14} color={theme.textSecondary} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginTop: 8,
  },
  embedded: {
    borderWidth: 0,
    paddingHorizontal: 0,
    marginTop: 0,
    backgroundColor: 'transparent',
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  body: { flex: 1, gap: 2 },
  title: { fontSize: 17, fontWeight: '600' },
  subtitle: { fontSize: 15 },
});
