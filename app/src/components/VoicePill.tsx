// Composer dictation control: rest circle → capsule with clock + simulated
// level bars (React Bits VoicePill, RN reimplementation). Toggle matches
// DictationPort start/stop; slide-left cancels. No second mic path.

import React, { useEffect, useRef, useState } from 'react';
import { PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  Easing,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { Icon } from './Icon';
import { VoicePillShell } from './VoicePillShell';
import { useTheme } from '../theme';
import { t } from '../i18n/strings';
import {
  formatVoiceElapsed,
  shouldCancelVoice,
  simulatedVoiceLevels,
  VOICE_PILL_BAR_COUNT,
  VOICE_PILL_OPEN_MS,
  VOICE_PILL_SIZE,
} from './voicePillMath';

export function VoicePill({
  active,
  supported,
  levelTick = 0,
  onToggle,
  onCancel,
}: {
  active: boolean;
  supported: boolean;
  levelTick?: number;
  onToggle: () => void;
  onCancel: () => void;
}) {
  const theme = useTheme();
  const reduceMotion = useReducedMotion();
  const open = useSharedValue(active ? 1 : 0);
  const slide = useSharedValue(0);
  const [elapsed, setElapsed] = useState('0:00');
  const [levels, setLevels] = useState(() =>
    simulatedVoiceLevels(0, VOICE_PILL_BAR_COUNT),
  );
  const [sliding, setSliding] = useState(false);
  const startedAt = useRef<number | null>(null);
  const cancelledRef = useRef(false);
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;

  useEffect(() => {
    open.value = withTiming(active ? 1 : 0, {
      duration: reduceMotion ? 0 : VOICE_PILL_OPEN_MS,
      easing: Easing.out(Easing.cubic),
    });
    if (active) {
      startedAt.current = Date.now();
      setElapsed('0:00');
    } else {
      startedAt.current = null;
      slide.value = 0;
    }
  }, [active, open, reduceMotion, slide]);

  useEffect(() => {
    if (!active) return;
    const tick = () => {
      const start = startedAt.current ?? Date.now();
      setElapsed(formatVoiceElapsed(Date.now() - start));
      if (!reduceMotion) {
        setLevels(
          simulatedVoiceLevels(Date.now(), VOICE_PILL_BAR_COUNT, levelTick),
        );
      }
    };
    tick();
    const id = setInterval(tick, reduceMotion ? 250 : 50);
    return () => clearInterval(id);
  }, [active, levelTick, reduceMotion]);

  const setSlidingRef = useRef(setSliding);
  setSlidingRef.current = setSliding;
  const reduceMotionRef = useRef(reduceMotion);
  reduceMotionRef.current = reduceMotion;
  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) =>
        g.dx < -10 && Math.abs(g.dx) > Math.abs(g.dy),
      onPanResponderMove: (_e, g) => {
        slide.value = Math.min(0, g.dx);
        setSlidingRef.current(g.dx < -8);
      },
      onPanResponderRelease: (_e, g) => {
        if (shouldCancelVoice(g.dx)) {
          cancelledRef.current = true;
          onCancelRef.current();
        }
        setSlidingRef.current(false);
        slide.value = withTiming(0, {
          duration: reduceMotionRef.current ? 0 : 160,
        });
      },
      onPanResponderTerminate: () => {
        setSlidingRef.current(false);
        slide.value = withTiming(0, { duration: 160 });
      },
    }),
  ).current;

  const fill = active ? theme.text : theme.inputBackground;
  const iconColor = !supported
    ? theme.sendInactive
    : active
    ? theme.scheme === 'dark'
      ? '#000000'
      : '#FFFFFF'
    : theme.textSecondary;
  const accent = active
    ? theme.scheme === 'dark'
      ? '#000000'
      : '#FFFFFF'
    : theme.textSecondary;

  return (
    <Pressable
      onPress={() => {
        if (cancelledRef.current) {
          cancelledRef.current = false;
          return;
        }
        if (supported) onToggle();
      }}
      disabled={!supported}
      hitSlop={{ top: 6, bottom: 6, right: 6, left: 0 }}
      accessibilityRole="button"
      accessibilityLabel={t('composer.dictate')}
      accessibilityState={{ disabled: !supported, busy: active }}
      accessibilityHint={
        supported ? undefined : t('composer.dictationUnavailable')
      }
      style={styles.hit}
    >
      <VoicePillShell
        open={open}
        slide={slide}
        panHandlers={active ? pan.panHandlers : undefined}
        style={[
          styles.pill,
          { backgroundColor: fill },
          supported ? undefined : styles.pillDim,
        ]}
      >
        {active ? (
          <View style={styles.openRow} pointerEvents="none">
            {sliding ? (
              <Text style={[styles.cancel, { color: accent }]}>
                {t('common.cancel')}
              </Text>
            ) : null}
            <Text style={[styles.clock, { color: accent }]}>{elapsed}</Text>
            <View style={styles.bars}>
              {levels.map((level, i) => (
                <View
                  key={i}
                  style={[
                    styles.bar,
                    {
                      height: 4 + level * 14,
                      backgroundColor: accent,
                    },
                  ]}
                />
              ))}
            </View>
          </View>
        ) : null}
        <View style={styles.iconSlot}>
          <Icon
            name={active ? 'stop.fill' : 'mic'}
            size={active ? 13 : 17}
            color={iconColor}
          />
        </View>
      </VoicePillShell>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  hit: {
    minWidth: VOICE_PILL_SIZE,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 0,
    paddingLeft: 0,
  },
  pill: {
    height: VOICE_PILL_SIZE,
    borderRadius: VOICE_PILL_SIZE / 2,
    overflow: 'hidden',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  pillDim: { opacity: 0.45 },
  openRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 10,
    gap: 6,
  },
  cancel: { fontSize: 11, fontWeight: '600', opacity: 0.55 },
  clock: { fontSize: 12, fontWeight: '600', fontVariant: ['tabular-nums'] },
  bars: {
    flex: 1,
    height: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  bar: {
    width: 2,
    borderRadius: 1,
  },
  iconSlot: {
    width: VOICE_PILL_SIZE,
    height: VOICE_PILL_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
