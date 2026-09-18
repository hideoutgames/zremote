// Centered effort overlay above the keyboard. Backdrop tap dismisses;
// OverKeyboardView keeps the composer focused.

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { OverKeyboardView } from 'react-native-keyboard-controller';
import { useTheme } from '../theme';
import { capitalizeEffort } from './modelLabel';
import { EffortSlider } from './EffortSlider';

export function EffortOverlay({
  visible,
  levels,
  value,
  modelShortLabel,
  onChange,
  onClose,
}: {
  visible: boolean;
  levels: readonly string[];
  value: string | undefined;
  modelShortLabel?: string;
  onChange: (level: string) => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const current = value ?? levels[0] ?? '';
  const title = [modelShortLabel, capitalizeEffort(current)]
    .filter(s => s !== undefined && s !== '')
    .join(' ');

  return (
    <OverKeyboardView visible={visible}>
      <Pressable
        style={styles.scrim}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel={title}
      >
        <Pressable onPress={e => e.stopPropagation()} style={styles.panel}>
          <Text style={[styles.label, { color: theme.text }]} numberOfLines={1}>
            {title}
          </Text>
          <View style={styles.slider}>
            <EffortSlider levels={levels} value={value} onChange={onChange} />
          </View>
        </Pressable>
      </Pressable>
    </OverKeyboardView>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 28,
  },
  panel: {
    width: '100%',
    maxWidth: 360,
    gap: 16,
    alignItems: 'center',
  },
  label: {
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
  },
  slider: { width: '100%' },
});
