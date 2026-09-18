// Floating effort overlay: fading blur field + Liquid Glass pill + Fast mode.

import React from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { Glass } from './Glass';
import { EffortSlider } from './EffortSlider';
import { capitalizeLevel } from './effortSliderMath';
import { useTheme } from '../theme';
import { t } from '../i18n/strings';

export function EffortOverlay({
  levels,
  value,
  onChange,
  showFast,
  fastEnabled,
  onToggleFast,
  onDismiss,
}: {
  levels: readonly string[];
  value: string | undefined;
  onChange: (level: string) => void;
  showFast: boolean;
  fastEnabled: boolean;
  onToggleFast: (on: boolean) => void;
  onDismiss: () => void;
}) {
  const theme = useTheme();
  const label = capitalizeLevel(value ?? levels[0] ?? '');

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={onDismiss}
        accessibilityRole="button"
        accessibilityLabel={t('common.done')}
      />
      <View style={styles.center} pointerEvents="box-none">
        <View style={styles.field} pointerEvents="none">
          <BlurView
            tint={
              theme.scheme === 'dark'
                ? 'systemThinMaterialDark'
                : 'systemThinMaterialLight'
            }
            intensity={28}
            style={StyleSheet.absoluteFill}
          />
          <View
            style={[
              styles.fade,
              theme.scheme === 'dark' ? styles.fadeDark : styles.fadeLight,
            ]}
          />
        </View>
        <View style={styles.panel} pointerEvents="box-none">
          <Text style={[styles.label, { color: theme.text }]}>{label}</Text>
          <Glass style={styles.pill}>
            {levels.length > 0 ? (
              <EffortSlider levels={levels} value={value} onChange={onChange} />
            ) : (
              <Text
                style={[styles.unsupported, { color: theme.textSecondary }]}
              >
                {t('picker.effortUnsupported')}
              </Text>
            )}
          </Glass>
          {showFast ? (
            <View style={styles.fastRow}>
              <Text style={[styles.fastLabel, { color: theme.text }]}>
                {t('picker.fastMode')}
              </Text>
              <Switch
                value={fastEnabled}
                onValueChange={onToggleFast}
                accessibilityLabel={t('picker.fastMode')}
              />
            </View>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  field: {
    position: 'absolute',
    left: 12,
    right: 12,
    top: '28%',
    bottom: '28%',
    borderRadius: 36,
    overflow: 'hidden',
  },
  fade: {
    ...StyleSheet.absoluteFill,
    opacity: 0.55,
  },
  fadeDark: { backgroundColor: 'rgba(0,0,0,0.35)' },
  fadeLight: { backgroundColor: 'rgba(255,255,255,0.28)' },
  panel: {
    width: '100%',
    maxWidth: 360,
    alignItems: 'center',
    gap: 12,
  },
  label: { fontSize: 22, fontWeight: '600' },
  pill: {
    width: '100%',
    borderRadius: 32,
    paddingHorizontal: 10,
    overflow: 'hidden',
  },
  unsupported: { padding: 20, fontSize: 13, textAlign: 'center' },
  fastRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingTop: 4,
  },
  fastLabel: { fontSize: 15, fontWeight: '500' },
});
