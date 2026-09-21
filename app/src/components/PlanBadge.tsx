// Plan badge — amber pill matching Cursor Mobile. Composer shows a
// dismiss X; transcript user bubbles reuse a compact inline chip nested
// in the prompt Text so it sits on the first line with the message.

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon } from './Icon';
import { useTheme } from '../theme';
import { t } from '../i18n/strings';
import type { PromptBadgeKind } from './planMode';

export function PlanBadge({
  onDismiss,
  kind = 'plan',
  variant = 'chip',
}: {
  onDismiss?: () => void;
  kind?: PromptBadgeKind;
  variant?: 'chip' | 'inline';
}) {
  const theme = useTheme();
  const label = kind === 'build' ? t('composer.build') : t('composer.plan');
  const inline = variant === 'inline';
  return (
    <View
      style={[
        styles.badge,
        inline ? styles.inlineBadge : undefined,
        { backgroundColor: theme.planBadgeFill },
      ]}
      accessibilityRole="text"
      accessibilityLabel={label}
    >
      <Icon
        name="list.bullet.indent"
        size={inline ? 11 : 13}
        color={theme.planBadge}
      />
      <Text
        style={[
          styles.label,
          inline ? styles.inlineLabel : undefined,
          { color: theme.planBadge },
        ]}
      >
        {label}
      </Text>
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
  inlineBadge: {
    gap: 4,
    borderRadius: 10,
    paddingLeft: 8,
    paddingRight: 6,
    paddingVertical: 2,
  },
  label: { fontSize: 14, fontWeight: '600' },
  inlineLabel: { fontSize: 12, fontWeight: '600' },
});
