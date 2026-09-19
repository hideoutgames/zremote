// Centered effort overlay: soft oval wash behind the level label + slider,
// Liquid Glass pill. Composer mounts it in a transparent Modal (not
// KeyboardStickyView) and morphs a glass pill from the chip's window rect
// to mid-screen height, centered on the composer column on iPad (window
// center on iPhone) via RN Animated (no Reanimated worklets). The model
// picker hosts it `embedded` inside the already-presented sheet so it is
// not stacked behind the formSheet / TrueSheet. Fast mode lives on the
// composer chip, not here.

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
import { useDismissibleNativeModal } from '../hooks/useDismissibleNativeModal';
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
/** Horizontal pad so the wash fades outside the pill, not through it. */
const WASH_PAD_X_RATIO = 0.5;
/** Vertical pad around the label + slider cluster. */
const WASH_PAD_Y_RATIO = 0.5;

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
  const height = effortSliderTrackHeight;
  return {
    x: bounds.x + (bounds.width - width) / 2,
    // Always mid-screen in Y. The iPad composer anchor only shifts X so
    // the overlay stays on the composer column, not the sidebar.
    y: (windowHeight - height) / 2,
    width,
    height,
  };
};

/** Soft wash around the label + pill. Inner plateau matches the cluster. */
export const effortWashRect = (dest: EffortOrigin): EffortOrigin => {
  const clusterHeight = dest.height + LABEL_OFFSET;
  const padX = dest.width * WASH_PAD_X_RATIO;
  const padY = clusterHeight * WASH_PAD_Y_RATIO;
  return {
    x: dest.x - padX,
    y: dest.y - LABEL_OFFSET - padY,
    width: dest.width + padX * 2,
    height: clusterHeight + padY * 2,
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
  embedded = false,
}: {
  levels: readonly string[];
  value: string | undefined;
  onChange: (level: string) => void;
  origin?: EffortOrigin;
  /** When set (iPad), the pill centers on this composer column in X. */
  anchor?: EffortOrigin;
  onDismiss: () => void;
  /** Host inside an already-presented sheet — no second Modal, flex-centered. */
  embedded?: boolean;
}) {
  const theme = useTheme();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const reduceMotion = useReducedMotion();
  const dest = useMemo(
    () => effortDestRect(windowWidth, windowHeight, anchor),
    [anchor, windowWidth, windowHeight],
  );
  const wash = useMemo(() => effortWashRect(dest), [dest]);
  const skipMorph =
    embedded || reduceMotion === true || origin === undefined;
  const start = skipMorph ? dest : origin;
  const left = useRef(new Animated.Value(start.x)).current;
  const top = useRef(new Animated.Value(start.y)).current;
  const pillW = useRef(new Animated.Value(start.width)).current;
  const pillH = useRef(new Animated.Value(start.height)).current;
  const contentOpacity = useRef(new Animated.Value(skipMorph ? 1 : 0)).current;
  const washOpacity = useRef(new Animated.Value(skipMorph ? 1 : 0)).current;
  const closing = useRef(false);
  const {
    visible,
    hide,
    onDismiss: onModalDismiss,
  } = useDismissibleNativeModal(onDismiss);
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

  const finishDismiss = useCallback(() => {
    if (embedded) onDismiss();
    else hide();
  }, [embedded, hide, onDismiss]);

  const close = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    const fadeMs = skipMorph ? 160 : MORPH_MS;
    const fade = [
      Animated.timing(washOpacity, {
        toValue: 0,
        duration: fadeMs,
        useNativeDriver: false,
      }),
      Animated.timing(contentOpacity, {
        toValue: 0,
        duration: 120,
        useNativeDriver: false,
      }),
    ];
    if (embedded) {
      Animated.parallel(fade).start(({ finished }) => {
        if (finished) finishDismiss();
        else closing.current = false;
      });
      return;
    }
    const end = skipMorph ? dest : origin!;
    Animated.parallel([
      Animated.timing(left, {
        toValue: end.x,
        duration: fadeMs,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: false,
      }),
      Animated.timing(top, {
        toValue: end.y,
        duration: fadeMs,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: false,
      }),
      Animated.timing(pillW, {
        toValue: end.width,
        duration: fadeMs,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: false,
      }),
      Animated.timing(pillH, {
        toValue: end.height,
        duration: fadeMs,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: false,
      }),
      ...fade,
    ]).start(({ finished }) => {
      if (finished) finishDismiss();
      else closing.current = false;
    });
  }, [
    contentOpacity,
    dest,
    embedded,
    finishDismiss,
    left,
    origin,
    pillH,
    pillW,
    skipMorph,
    top,
    washOpacity,
  ]);

  const slider = (
    <>
      {levels.length > 0 ? (
        <EffortSlider levels={levels} value={value} onChange={onChange} />
      ) : (
        <Text style={[styles.unsupported, { color: theme.textSecondary }]}>
          {t('picker.effortUnsupported')}
        </Text>
      )}
    </>
  );

  const backdrop = (
    <Pressable
      style={StyleSheet.absoluteFill}
      onPress={close}
      accessibilityRole="button"
      accessibilityLabel={t('common.done')}
    />
  );

  const labelStyle = [
    styles.label,
    theme.scheme === 'dark' ? styles.labelShadowDark : styles.labelShadowLight,
    { color: theme.text },
  ];

  if (embedded) {
    return (
      <View style={styles.embeddedRoot} pointerEvents="box-none">
        {backdrop}
        <Animated.View
          pointerEvents="none"
          style={[styles.embeddedWash, { opacity: washOpacity }]}
        >
          <FadeBlur
            fade="radial"
            intensity={40}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
        <Animated.View
          pointerEvents="box-none"
          style={[styles.embeddedCluster, { opacity: contentOpacity }]}
        >
          <Text pointerEvents="none" style={[labelStyle, styles.embeddedLabel]}>
            {label}
          </Text>
          <View style={styles.embeddedPill}>
            <Glass animated interactive style={styles.pill}>
              <View style={styles.sliderFade}>{slider}</View>
            </Glass>
          </View>
        </Animated.View>
      </View>
    );
  }

  return (
    <Modal
      transparent
      animationType="none"
      visible={visible}
      onRequestClose={close}
      onDismiss={onModalDismiss}
      statusBarTranslucent
    >
      <View style={styles.root} pointerEvents="box-none">
        {backdrop}
        <Animated.View
          pointerEvents="none"
          style={[
            styles.band,
            {
              left: wash.x,
              width: wash.width,
              top: wash.y,
              height: wash.height,
              opacity: washOpacity,
            },
          ]}
        >
          <FadeBlur
            fade="radial"
            intensity={40}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
        <Animated.Text
          pointerEvents="none"
          style={[
            labelStyle,
            {
              left: dest.x,
              width: dest.width,
              top: dest.y - LABEL_OFFSET,
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
              {slider}
            </Animated.View>
          </Glass>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  embeddedRoot: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 20,
  },
  embeddedWash: {
    position: 'absolute',
    width: '200%',
    height: '200%',
    left: '-50%',
    top: '-50%',
  },
  embeddedCluster: {
    width: '100%',
    maxWidth: PILL_MAX_WIDTH,
    paddingHorizontal: PILL_H_INSET,
    alignItems: 'center',
  },
  embeddedLabel: {
    position: 'relative',
    marginBottom: 12,
    width: '100%',
  },
  embeddedPill: {
    width: '100%',
    height: effortSliderTrackHeight,
  },
  band: {
    position: 'absolute',
  },
  label: {
    position: 'absolute',
    textAlign: 'center',
    fontSize: 17,
    fontWeight: '600',
  },
  labelShadowDark: {
    textShadowColor: 'rgba(0,0,0,0.85)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 8,
  },
  labelShadowLight: {
    textShadowColor: 'rgba(255,255,255,0.9)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 8,
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
