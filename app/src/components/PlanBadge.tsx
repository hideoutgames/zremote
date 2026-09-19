// Plan badge — amber pill matching Cursor Mobile. Composer shows a
// dismiss X; transcript user bubbles reuse the same chip without it.

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon } from './Icon';
import { useTheme } from '../theme';
import { t } from '../i18n/strings';
import type { PromptBadgeKind } from './planMode';

export function PlanBadge({
  onDismiss,
  kind = 'plan',
}: {
  onDismiss?: () => void;
  kind?: PromptBadgeKind;
}) {
  const theme = useTheme();
  const label = kind === 'build' ? t('composer.build') : t('composer.plan');
  return (
    <View
      style={[styles.badge, { backgroundColor: theme.planBadgeFill }]}
      accessibilityRole="text"
      accessibilityLabel={label}
    >
      <Icon name="list.bullet.indent" size={13} color={theme.planBadge} />
      <Text style={[styles.label, { color: theme.planBadge }]}>{label}</Text>
      {onDismiss !== undefined ? (
        <Pressable
          onPress={onDismiss}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t('composer.plan.off')}
        >
          <Icon name="xmark" size={11} color={theme.planBadge} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 0,
    gap: 5,
    borderRadius: 16,
    paddingLeft: 10,
    paddingRight: 8,
    paddingVertical: 6,
  },
  label: { fontSize: 14, fontWeight: '600' },
});
