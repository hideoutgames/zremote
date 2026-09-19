// Borderless composer picker trigger: label + trailing chevron. Used by the
// model, effort, and Fast controls in place of the old filled pills.

import React, { type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Icon } from './Icon';

export function ComposerMenuChip({
  label,
  color,
  chevronColor,
  leading,
}: {
  label: string;
  color: string;
  chevronColor: string;
  leading?: ReactNode;
}) {
  return (
    <View style={styles.chip}>
      {leading}
      <Text style={[styles.text, { color }]} numberOfLines={1}>
        {label}
      </Text>
      <Icon name="chevron.down" size={10} color={chevronColor} />
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 32,
    paddingHorizontal: 4,
    gap: 4,
  },
  text: { fontSize: 13, maxWidth: 160, fontWeight: '600' },
});
