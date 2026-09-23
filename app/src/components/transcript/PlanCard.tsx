import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon } from '../Icon';
import { useTheme } from '../../theme';
import { t } from '../../i18n/strings';
import type { PlanArtifact } from './detectPlan';
import { useSuppressAfterLongPress } from '../../hooks/useSuppressAfterLongPress';

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
  const lp = useSuppressAfterLongPress();
  const subtitle =
    plan.markdown.trim() !== ''
      ? t('session.planReady')
      : t('session.planUntitled');
  return (
    <Pressable
      testID="plan-card"
      onPress={() => {
        if (lp.isSuppressed()) return;
        onOpen();
      }}
      onPressIn={lp.onPressIn}
      onLongPress={lp.onLongPress}
      accessibilityRole="button"
      accessibilityLabel={`${plan.name}. ${subtitle}`}
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
      <Icon name="list.bullet.indent" size={16} color={theme.planBadge} />
      <View style={styles.body}>
        <Text style={[styles.title, { color: theme.text }]} numberOfLines={2}>
          {plan.name}
        </Text>
        <Text
          style={[styles.subtitle, { color: theme.textSecondary }]}
          numberOfLines={1}
        >
          {subtitle}
        </Text>
      </View>
      <Icon name="chevron.right" size={14} color={theme.textSecondary} />
    </Pressable>
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
  body: { flex: 1, gap: 2 },
  title: { fontSize: 17, fontWeight: '600' },
  subtitle: { fontSize: 15 },
});
