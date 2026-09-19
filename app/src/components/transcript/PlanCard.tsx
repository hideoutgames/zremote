import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon } from '../Icon';
import { PlanBadge } from '../PlanBadge';
import { useTheme } from '../../theme';
import type { PlanArtifact } from './detectPlan';

export function PlanCard({
  plan,
  onOpen,
  embedded = false,
}: {
  plan: PlanArtifact;
  onOpen: () => void;
  embedded?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel={plan.name}
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
      <PlanBadge />
      <View style={styles.row}>
        <Text style={[styles.name, { color: theme.text }]} numberOfLines={2}>
          {plan.name}
        </Text>
        <Icon name="chevron.right" size={14} color={theme.textSecondary} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginTop: 8,
    gap: 8,
    alignItems: 'flex-start',
  },
  embedded: {
    borderWidth: 0,
    paddingHorizontal: 0,
    marginTop: 0,
    backgroundColor: 'transparent',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'stretch',
  },
  name: { flex: 1, fontSize: 16, fontWeight: '600' },
});
