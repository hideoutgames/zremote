// Centered effort overlay above the keyboard. Backdrop tap dismisses;
// OverKeyboardView keeps the composer focused. The slider sits on clear
// Liquid Glass; a wide alpha-only radial wash sits behind it.

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Canvas, RadialGradient, Circle, vec } from '@shopify/react-native-skia';
import { OverKeyboardView } from 'react-native-keyboard-controller';
import { useTheme } from '../theme';
import { capitalizeEffort } from './modelLabel';
import { EffortSlider } from './EffortSlider';
import { Glass } from './Glass';

const WASH = 420;

export function EffortOverlay({
  visible,
  levels,
  value,
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
  const wash = theme.scheme === 'dark' ? 'rgba(0,0,0,0.45)' : 'rgba(0,0,0,0.18)';

  return (
    <OverKeyboardView visible={visible}>
      <Pressable
        style={styles.scrim}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel={capitalizeEffort(current)}
      >
        <Pressable onPress={e => e.stopPropagation()} style={styles.panel}>
          <View pointerEvents="none" style={styles.wash}>
            <Canvas style={styles.washCanvas}>
              <Circle cx={WASH / 2} cy={WASH / 2} r={WASH / 2}>
                <RadialGradient
                  c={vec(WASH / 2, WASH / 2)}
                  r={WASH / 2}
                  colors={[wash, 'rgba(0,0,0,0)']}
                />
              </Circle>
            </Canvas>
          </View>
          <Glass effect="clear" style={styles.glass}>
            <Text
              style={[styles.label, { color: theme.text }]}
              numberOfLines={1}
            >
              {capitalizeEffort(current)}
            </Text>
            <View style={styles.slider}>
              <EffortSlider
                levels={levels}
                value={value}
                onChange={onChange}
                tone="glass"
              />
            </View>
          </Glass>
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
    maxWidth: 380,
    alignItems: 'center',
  },
  wash: {
    position: 'absolute',
    width: WASH,
    height: WASH,
    top: 48,
    alignSelf: 'center',
  },
  washCanvas: { width: WASH, height: WASH },
  glass: {
    width: '100%',
    borderRadius: 28,
    paddingHorizontal: 20,
    paddingVertical: 18,
    gap: 14,
    alignItems: 'center',
    overflow: 'hidden',
  },
  label: {
    fontSize: 17,
    fontWeight: '600',
    textAlign: 'center',
  },
  slider: { width: '100%' },
});
