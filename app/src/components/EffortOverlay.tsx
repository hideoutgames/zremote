// Centered effort overlay: short edge-to-edge fade + Liquid Glass pill.
// Mounted in a transparent Modal (not KeyboardStickyView). Opens by
// morphing a glass pill from the composer chip's window rect to screen
// center via RN Animated (no Reanimated worklets). Fast mode lives on
// the composer chip, not here.

import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  Animated,
  Easing,
  Keyboard,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { Glass } from './Glass';
import { FadeBlur } from './FadeBlur';
import { EffortSlider } from './EffortSlider';
import { capitalizeLevel, effortSliderTrackHeight } from './effortSliderMath';
import { useTheme } from '../theme';
import { t } from '../i18n/strings';

export interface EffortOrigin {
  x: number;
  y: number;
  width: number;
  height: number;
}

const MORPH_MS = 280;
const PILL_MAX_WIDTH = 360;
const PILL_H_INSET = 28;
const LABEL_OFFSET = 36;

const destRect = (windowWidth: number, windowHeight: number): EffortOrigin => {
  const width = Math.min(
    PILL_MAX_WIDTH,
    Math.max(windowWidth - PILL_H_INSET * 2, 0),
  );
  const height = effortSliderTrackHeight;
  return {
    x: (windowWidth - width) / 2,
    y: (windowHeight - height) / 2,
    width,
    height,
  };
};

export function EffortOverlay({
  levels,
  value,
  onChange,
  origin,
  onDismiss,
}: {
  levels: readonly string[];
  value: string | undefined;
  onChange: (level: string) => void;
  origin?: EffortOrigin;
  onDismiss: () => void;
}) {
  const theme = useTheme();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const reduceMotion = useReducedMotion();
  const dest = useMemo(
    () => destRect(windowWidth, windowHeight),
    [windowWidth, windowHeight],
  );
  const skipMorph = reduceMotion === true || origin === undefined;
  const start = skipMorph ? dest : origin;
  const left = useRef(new Animated.Value(start.x)).current;
  const top = useRef(new Animated.Value(start.y)).current;
  const pillW = useRef(new Animated.Value(start.width)).current;
  const pillH = useRef(new Animated.Value(start.height)).current;
  const contentOpacity = useRef(new Animated.Value(skipMorph ? 1 : 0)).current;
  const washOpacity = useRef(new Animated.Value(skipMorph ? 1 : 0)).current;
  const closing = useRef(false);
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;
  const label = capitalizeLevel(value ?? levels[0] ?? '');

  useEffect(() => {
    Keyboard.dismiss();
  }, []);

  useEffect(() => {
    if (skipMorph) return;
    Animated.parallel([
      Animated.timing(left, {
        toValue: dest.x,
        duration: MORPH_MS,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }),
      Animated.timing(top, {
        toValue: dest.y,
        duration: MORPH_MS,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }),
      Animated.timing(pillW, {
        toValue: dest.width,
        duration: MORPH_MS,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }),
      Animated.timing(pillH, {
        toValue: dest.height,
        duration: MORPH_MS,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }),
      Animated.timing(washOpacity, {
        toValue: 1,
        duration: MORPH_MS,
        useNativeDriver: false,
      }),
      Animated.timing(contentOpacity, {
        toValue: 1,
        duration: 200,
        delay: 80,
        useNativeDriver: false,
      }),
    ]).start();
  }, [
    contentOpacity,
    dest.height,
    dest.width,
    dest.x,
    dest.y,
    left,
    pillH,
    pillW,
    skipMorph,
    top,
    washOpacity,
  ]);

  const close = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    const end = skipMorph ? dest : origin!;
    Animated.parallel([
      Animated.timing(left, {
        toValue: end.x,
        duration: skipMorph ? 160 : MORPH_MS,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: false,
      }),
      Animated.timing(top, {
        toValue: end.y,
        duration: skipMorph ? 160 : MORPH_MS,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: false,
      }),
      Animated.timing(pillW, {
        toValue: end.width,
        duration: skipMorph ? 160 : MORPH_MS,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: false,
      }),
      Animated.timing(pillH, {
        toValue: end.height,
        duration: skipMorph ? 160 : MORPH_MS,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: false,
      }),
      Animated.timing(washOpacity, {
        toValue: 0,
        duration: skipMorph ? 160 : MORPH_MS,
        useNativeDriver: false,
      }),
      Animated.timing(contentOpacity, {
        toValue: 0,
        duration: 120,
        useNativeDriver: false,
      }),
    ]).start(({ finished }) => {
      if (finished) onDismissRef.current();
      else closing.current = false;
    });
  }, [
    contentOpacity,
    dest,
    left,
    origin,
    pillH,
    pillW,
    skipMorph,
    top,
    washOpacity,
  ]);

  return (
    <Modal
      transparent
      animationType="none"
      visible
      onRequestClose={close}
      statusBarTranslucent
    >
      <View style={styles.root} pointerEvents="box-none">
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={close}
          accessibilityRole="button"
          accessibilityLabel={t('common.done')}
        />
        <Animated.View
          pointerEvents="none"
          style={[
            styles.band,
            {
              top: dest.y - LABEL_OFFSET - 24,
              height: dest.height + LABEL_OFFSET + 48,
              opacity: washOpacity,
            },
          ]}
        >
          <FadeBlur
            fade="vertical"
            intensity={40}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
        <Animated.Text
          pointerEvents="none"
          style={[
            styles.label,
            {
              color: theme.text,
              top: dest.y - LABEL_OFFSET,
              opacity: contentOpacity,
              textShadowColor:
                theme.scheme === 'dark'
                  ? 'rgba(0,0,0,0.85)'
                  : 'rgba(255,255,255,0.9)',
              textShadowOffset: { width: 0, height: 1 },
              textShadowRadius: 8,
            },
          ]}
        >
          {label}
        </Animated.Text>
        <Animated.View
          pointerEvents="box-none"
          style={[styles.pillWrap, { left, top, width: pillW, height: pillH }]}
        >
          <Glass animated interactive style={styles.pill}>
            <Animated.View
              style={[styles.sliderFade, { opacity: contentOpacity }]}
            >
              {levels.length > 0 ? (
                <EffortSlider
                  levels={levels}
                  value={value}
                  onChange={onChange}
                />
              ) : (
                <Text
                  style={[styles.unsupported, { color: theme.textSecondary }]}
                >
                  {t('picker.effortUnsupported')}
                </Text>
              )}
            </Animated.View>
          </Glass>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  band: {
    position: 'absolute',
    left: 0,
    right: 0,
  },
  label: {
    position: 'absolute',
    left: 0,
    right: 0,
    textAlign: 'center',
    fontSize: 17,
    fontWeight: '600',
  },
  pillWrap: {
    position: 'absolute',
  },
  pill: {
    flex: 1,
    borderRadius: effortSliderTrackHeight / 2,
    paddingHorizontal: 10,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  sliderFade: { justifyContent: 'center' },
  unsupported: { padding: 20, fontSize: 13, textAlign: 'center' },
});
