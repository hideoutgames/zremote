// Centered effort overlay: short edge-to-edge fade + Liquid Glass pill.
// Mounted in a transparent Modal (not KeyboardStickyView). Opens by
// morphing a glass pill from the composer chip's window rect to the
// composer (or window) center via RN Animated (no Reanimated worklets).
// Fast mode lives on the composer chip, not here.

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
const BAND_HEIGHT = 160;

export const effortDestRect = (
  windowWidth: number,
  windowHeight: number,
  anchor?: EffortOrigin,
): EffortOrigin => {
  const bounds = anchor ?? {
    x: 0,
    y: 0,
    width: windowWidth,
    height: windowHeight,
  };
  const width = Math.min(
    PILL_MAX_WIDTH,
    Math.max(bounds.width - PILL_H_INSET * 2, 0),
  );
  const height = effortSliderTrackHeight + 16;
  return {
    x: bounds.x + (bounds.width - width) / 2,
    y: bounds.y + (bounds.height - height) / 2,
    width,
    height,
  };
};

export const measureWindowRect = (
  node: {
    measureInWindow?: (
      callback: (x: number, y: number, width: number, height: number) => void,
    ) => void;
  } | null,
  callback: (rect: EffortOrigin | undefined) => void,
): void => {
  if (node !== null && typeof node.measureInWindow === 'function') {
    node.measureInWindow((x, y, width, height) => {
      callback({ x, y, width, height });
    });
    return;
  }
  callback(undefined);
};

export function EffortOverlay({
  levels,
  value,
  onChange,
  origin,
  anchor,
  onDismiss,
}: {
  levels: readonly string[];
  value: string | undefined;
  onChange: (level: string) => void;
  origin?: EffortOrigin;
  /** When set (iPad), the pill centers on this composer/detail rect. */
  anchor?: EffortOrigin;
  onDismiss: () => void;
}) {
  const theme = useTheme();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const reduceMotion = useReducedMotion();
  const dest = useMemo(
    () => effortDestRect(windowWidth, windowHeight, anchor),
    [anchor, windowWidth, windowHeight],
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
              left: dest.x,
              width: dest.width,
              top: dest.y + dest.height / 2 - BAND_HEIGHT / 2,
              opacity: washOpacity,
            },
          ]}
        >
          <FadeBlur
            fade="vertical"
            intensity={28}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
        <Animated.Text
          pointerEvents="none"
          style={[
            styles.label,
            {
              color: theme.text,
              left: dest.x,
              width: dest.width,
              top: dest.y - 36,
              opacity: contentOpacity,
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
    height: BAND_HEIGHT,
  },
  label: {
    position: 'absolute',
    textAlign: 'center',
    fontSize: 17,
    fontWeight: '600',
  },
  pillWrap: {
    position: 'absolute',
  },
  pill: {
    flex: 1,
    borderRadius: 32,
    paddingHorizontal: 10,
    overflow: 'hidden',
  },
  sliderFade: { flex: 1 },
  unsupported: { padding: 20, fontSize: 13, textAlign: 'center' },
});
