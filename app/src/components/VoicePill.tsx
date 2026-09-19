// Composer dictation control: rest circle → capsule with clock + simulated
// level bars (React Bits VoicePill, RN reimplementation). Toggle matches
// DictationPort start/stop; slide-left cancels. While listening or in the
// 2s processing cooldown the circle covers send (layout slot stays 32px).

import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
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
  VOICE_PILL_SEND_HIT,
  VOICE_PILL_SIZE,
} from './voicePillMath';

export function VoicePill({
  active,
  supported,
  processing = false,
  levelTick = 0,
  onToggle,
  onCancel,
}: {
  active: boolean;
  supported: boolean;
  processing?: boolean;
  levelTick?: number;
  onToggle: () => void;
  onCancel: () => void;
}) {
  const theme = useTheme();
  const reduceMotion = useReducedMotion();
  const covering = active || processing;
  const open = useSharedValue(active ? 1 : 0);
  const cover = useSharedValue(covering ? 1 : 0);
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
    const duration = reduceMotion ? 0 : VOICE_PILL_OPEN_MS;
    open.value = withTiming(active ? 1 : 0, {
      duration,
      easing: Easing.out(Easing.cubic),
    });
    cover.value = withTiming(covering ? 1 : 0, {
      duration,
      easing: Easing.out(Easing.cubic),
    });
    if (active) {
      startedAt.current = Date.now();
      setElapsed('0:00');
    } else {
      startedAt.current = null;
      slide.value = 0;
    }
  }, [active, covering, cover, open, reduceMotion, slide]);

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
    <View style={styles.slot} pointerEvents="box-none">
      <VoicePillShell
        open={open}
        cover={cover}
        slide={slide}
        panHandlers={active ? pan.panHandlers : undefined}
        style={[
          styles.pill,
          styles.float,
          { backgroundColor: fill },
          supported ? undefined : styles.pillDim,
        ]}
      >
        <Pressable
          onPress={() => {
            if (cancelledRef.current) {
              cancelledRef.current = false;
              return;
            }
            if (processing) return;
            if (supported) onToggle();
          }}
          disabled={!supported || processing}
          hitSlop={{ top: 6, bottom: 6, right: 6, left: 0 }}
          accessibilityRole="button"
          accessibilityLabel={
            processing
              ? t('composer.dictationProcessing')
              : active
              ? t('composer.stopDictation')
              : t('composer.dictate')
          }
          accessibilityState={{
            disabled: !supported || processing,
            busy: active || processing,
          }}
          accessibilityHint={
            supported ? undefined : t('composer.dictationUnavailable')
          }
          style={styles.press}
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
            {processing && !active ? (
              <ActivityIndicator size="small" color={theme.textSecondary} />
            ) : (
              <Icon
                name={active ? 'stop.fill' : 'mic'}
                size={active ? 13 : 17}
                color={iconColor}
              />
            )}
          </View>
        </Pressable>
      </VoicePillShell>
    </View>
  );
}

const styles = StyleSheet.create({
  slot: {
    width: VOICE_PILL_SIZE,
    height: VOICE_PILL_SEND_HIT,
    zIndex: 2,
  },
  float: {
    position: 'absolute',
    left: 0,
    top: (VOICE_PILL_SEND_HIT - VOICE_PILL_SIZE) / 2,
  },
  press: {
    flex: 1,
    height: VOICE_PILL_SIZE,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
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
    overflow: 'hidden',
  },
});
