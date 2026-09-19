// Effort slider strip: short edge-to-edge fade blur sitting above the
// composer (parent mounts it inside KeyboardStickyView). Fast mode lives
// on the composer chip, not here.

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Glass } from './Glass';
import { FadeBlur } from './FadeBlur';
import { EffortSlider } from './EffortSlider';
import { capitalizeLevel } from './effortSliderMath';
import { useTheme } from '../theme';
import { t } from '../i18n/strings';

export function EffortOverlay({
  levels,
  value,
  onChange,
}: {
  levels: readonly string[];
  value: string | undefined;
  onChange: (level: string) => void;
}) {
  const theme = useTheme();
  const label = capitalizeLevel(value ?? levels[0] ?? '');

  return (
    <View style={styles.strip} pointerEvents="box-none">
      <FadeBlur intensity={28} style={StyleSheet.absoluteFill} />
      <View style={styles.panel} pointerEvents="box-none">
        <Text style={[styles.label, { color: theme.text }]}>{label}</Text>
        <Glass style={styles.pill}>
          {levels.length > 0 ? (
            <EffortSlider levels={levels} value={value} onChange={onChange} />
          ) : (
            <Text style={[styles.unsupported, { color: theme.textSecondary }]}>
              {t('picker.effortUnsupported')}
            </Text>
          )}
        </Glass>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  strip: {
    width: '100%',
    minHeight: 118,
    justifyContent: 'flex-end',
    paddingBottom: 8,
    zIndex: 1,
  },
  panel: {
    width: '100%',
    maxWidth: 360,
    alignSelf: 'center',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 28,
  },
  label: { fontSize: 17, fontWeight: '600' },
  pill: {
    width: '100%',
    borderRadius: 32,
    paddingHorizontal: 10,
    overflow: 'hidden',
  },
  unsupported: { padding: 20, fontSize: 13, textAlign: 'center' },
});
