// Settings → Appearance: session wallpaper picker + effect segments.
// Bundled defaults sit in a horizontal thumbnail strip; custom photos
// still copy into the managed Documents folder.

import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { launchImageLibrary } from 'react-native-image-picker';
import { Icon } from '../Icon';
import { SettingsGroup, SettingsRow } from './SettingsList';
import {
  COLOR_SCHEME_PREFERENCES,
  useTheme,
  type ColorSchemePreference,
  type Theme,
} from '../../theme';
import { t, type StringKey } from '../../i18n/strings';
import {
  applyPresetBackground,
  installNewThreadComposerBackground,
  removeNewThreadComposerBackground,
  setColorSchemePreference,
  setNewThreadBackgroundEffect,
  setSessionBackgroundBlur,
  useColorSchemePreference,
  useNewThreadBackgroundEffect,
  useNewThreadComposerBackground,
  useSessionBackgroundBlur,
} from '../../zeron/state/uiPrefs';
import { DEFAULT_BACKGROUNDS } from '../../zeron/state/defaultBackgrounds';
import {
  NEW_THREAD_BACKGROUND_EFFECTS,
  isPresetBackground,
  isWallpaperAvailable,
  type NewThreadBackgroundEffect,
  type NewThreadComposerBackground,
} from '../../zeron/state/newThreadBackground';
import { createLog } from '../../zeron/log';

const log = createLog();

const TILE_W = 72;
const TILE_H = 96;
const TILE_RADIUS = 12;

const THEME_LABEL: Record<ColorSchemePreference, StringKey> = {
  system: 'settings.theme.system',
  dark: 'settings.theme.dark',
  light: 'settings.theme.light',
};

const EFFECT_LABEL: Record<NewThreadBackgroundEffect, StringKey> = {
  none: 'settings.backgroundEffect.none',
  dither: 'settings.backgroundEffect.dither',
  ascii: 'settings.backgroundEffect.ascii',
  halftone: 'settings.backgroundEffect.halftone',
  scanlines: 'settings.backgroundEffect.scanlines',
};

const EFFECT_HINT: Record<NewThreadBackgroundEffect, StringKey> = {
  none: 'settings.backgroundEffect.noneHint',
  dither: 'settings.backgroundEffect.ditherHint',
  ascii: 'settings.backgroundEffect.asciiHint',
  halftone: 'settings.backgroundEffect.halftoneHint',
  scanlines: 'settings.backgroundEffect.scanlinesHint',
};

const errorKey = (reason: 'tooLarge' | 'unsupported' | 'failed'): StringKey =>
  reason === 'tooLarge'
    ? 'settings.backgroundError.tooLarge'
    : reason === 'unsupported'
    ? 'settings.backgroundError.unsupported'
    : 'settings.backgroundError.failed';

const chooseBackground = async (): Promise<void> => {
  const result = await launchImageLibrary({
    mediaType: 'photo',
    selectionLimit: 1,
    includeBase64: false,
  });
  if (result.didCancel === true || result.assets == null) return;
  const asset = result.assets[0];
  if (asset === undefined || asset.uri === undefined) return;
  const installed = await installNewThreadComposerBackground({
    uri: asset.uri,
    name: asset.fileName ?? 'photo',
    mimeType: asset.type,
    size: asset.fileSize ?? 0,
  });
  if (installed.ok === false) {
    Alert.alert(
      t('settings.backgroundErrorTitle'),
      t(errorKey(installed.reason)),
    );
  }
};

function tileRing(theme: Theme, selected: boolean): { borderColor: string } {
  return { borderColor: selected ? theme.accent : 'transparent' };
}

function EffectSegment({
  effect,
  selected,
  last,
  onPress,
}: {
  effect: NewThreadBackgroundEffect;
  selected: boolean;
  last: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={t(EFFECT_LABEL[effect])}
      testID={`settings-background-effect-${effect}`}
      style={[
        styles.segment,
        last ? null : { borderRightColor: theme.border },
        last ? null : styles.segmentJoin,
        { backgroundColor: selected ? theme.accent : 'transparent' },
      ]}
    >
      <Text
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.65}
        style={[
          styles.segmentLabel,
          { color: selected ? '#FFFFFF' : theme.text },
        ]}
      >
        {t(EFFECT_LABEL[effect])}
      </Text>
    </Pressable>
  );
}

export function ThemePage() {
  const theme = useTheme();
  const pref = useColorSchemePreference();
  return (
    <SettingsGroup header={t('settings.theme')}>
      {COLOR_SCHEME_PREFERENCES.map(item => (
        <SettingsRow
          key={item}
          title={t(THEME_LABEL[item])}
          trailing={
            pref === item ? (
              <Icon name="checkmark" size={16} color={theme.accent} />
            ) : undefined
          }
          onPress={() => setColorSchemePreference(item)}
          testID={`settings-theme-${item}`}
          accessibilityLabel={t(THEME_LABEL[item])}
        />
      ))}
    </SettingsGroup>
  );
}

function wallpaperCaption(
  background: NewThreadComposerBackground | undefined,
  available: boolean,
): string {
  if (background === undefined) return t('settings.backgroundEmpty');
  if (!available) {
    return `${t('settings.backgroundUnavailable')}\n${t(
      'settings.backgroundUnavailableHint',
    )}`;
  }
  return t('settings.backgroundFrostHint');
}

export function AppearanceBackground({
  onOpenTheme,
}: {
  onOpenTheme: () => void;
}) {
  const theme = useTheme();
  const colorScheme = useColorSchemePreference();
  const background = useNewThreadComposerBackground();
  const effect = useNewThreadBackgroundEffect();
  const sessionBlur = useSessionBackgroundBlur();
  const [available, setAvailable] = useState(true);

  useEffect(() => {
    if (background === undefined) {
      setAvailable(true);
      return;
    }
    let cancelled = false;
    isWallpaperAvailable(background)
      .then(ok => {
        if (!cancelled) setAvailable(ok);
      })
      .catch(() => {
        if (!cancelled) setAvailable(false);
      });
    return () => {
      cancelled = true;
    };
  }, [background]);

  const onChoose = useCallback(() => {
    chooseBackground().catch(e => log.warn(`background pick: ${e}`));
  }, []);

  const onNone = useCallback(() => {
    removeNewThreadComposerBackground().catch(e =>
      log.warn(`background remove: ${e}`),
    );
  }, []);

  const onPreset = useCallback((id: string) => {
    applyPresetBackground(id).catch(e => log.warn(`background preset: ${e}`));
  }, []);

  const wallpaperOn = background !== undefined && available;
  const noneSelected = !wallpaperOn;
  const presetId =
    wallpaperOn && isPresetBackground(background) ? background.id : undefined;
  const customSelected =
    wallpaperOn && !isPresetBackground(background) ? background : undefined;

  return (
    <>
      <SettingsGroup
        header={t('settings.appearance')}
        footer={wallpaperCaption(background, available)}
      >
        <SettingsRow
          title={t('settings.theme')}
          value={t(THEME_LABEL[colorScheme])}
          showChevron
          onPress={onOpenTheme}
          testID="settings-theme"
          accessibilityLabel={`${t('settings.theme')}, ${t(
            THEME_LABEL[colorScheme],
          )}`}
        />
        <View style={styles.pickerBlock} testID="settings-background">
          <Text style={[styles.pickerTitle, { color: theme.text }]}>
            {t('settings.background')}
          </Text>
          <ScrollView
            horizontal
            nestedScrollEnabled
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.pickerRow}
            testID="settings-background-slider"
          >
            <Pressable
              onPress={onNone}
              accessibilityRole="button"
              accessibilityState={{ selected: noneSelected }}
              accessibilityLabel={t('settings.backgroundNone')}
              testID="settings-background-none"
              style={[styles.tileHit, tileRing(theme, noneSelected)]}
            >
              <View
                style={[
                  styles.tile,
                  { backgroundColor: theme.inputBackground },
                ]}
              >
                <Icon
                  name="slash.circle"
                  size={22}
                  color={theme.textSecondary}
                />
              </View>
            </Pressable>
            {DEFAULT_BACKGROUNDS.map((item, index) => {
              const selected = presetId === item.id;
              return (
                <Pressable
                  key={item.id}
                  onPress={() => onPreset(item.id)}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  accessibilityLabel={t('settings.backgroundPreset').replace(
                    '{n}',
                    String(index + 1),
                  )}
                  testID={`settings-background-preset-${item.id}`}
                  style={[styles.tileHit, tileRing(theme, selected)]}
                >
                  <Image
                    source={item.source}
                    style={styles.tile}
                    contentFit="cover"
                  />
                </Pressable>
              );
            })}
            <Pressable
              onPress={onChoose}
              accessibilityRole="button"
              accessibilityState={{ selected: customSelected !== undefined }}
              accessibilityLabel={t('settings.backgroundCustom')}
              testID="settings-background-custom"
              style={[
                styles.tileHit,
                tileRing(theme, customSelected !== undefined),
              ]}
            >
              {customSelected !== undefined ? (
                <Image
                  source={{ uri: customSelected.uri }}
                  style={styles.tile}
                  contentFit="cover"
                  testID="settings-background-thumb"
                />
              ) : (
                <View
                  style={[
                    styles.tile,
                    styles.customEmpty,
                    { borderColor: theme.border },
                  ]}
                >
                  <Icon name="plus" size={22} color={theme.accent} />
                </View>
              )}
            </Pressable>
          </ScrollView>
        </View>
      </SettingsGroup>
      <SettingsGroup footer={t('settings.sessionBackgroundBlurHint')}>
        <SettingsRow
          title={t('settings.sessionBackgroundBlur')}
          trailing={
            <Switch
              value={sessionBlur}
              onValueChange={setSessionBackgroundBlur}
              accessibilityLabel={t('settings.sessionBackgroundBlur')}
              testID="settings-session-background-blur"
            />
          }
        />
      </SettingsGroup>
      {wallpaperOn ? (
        <SettingsGroup>
          <View style={styles.effectBlock} testID="settings-background-effects">
            <Text style={[styles.effectTitle, { color: theme.text }]}>
              {t('settings.backgroundEffect')}
            </Text>
            <Text style={[styles.effectHint, { color: theme.textSecondary }]}>
              {t(EFFECT_HINT[effect])}
            </Text>
            <View
              style={[styles.segments, { borderColor: theme.border }]}
              testID="settings-background-effect-segments"
            >
              {NEW_THREAD_BACKGROUND_EFFECTS.map((item, index) => (
                <EffectSegment
                  key={item}
                  effect={item}
                  selected={item === effect}
                  last={index === NEW_THREAD_BACKGROUND_EFFECTS.length - 1}
                  onPress={() => setNewThreadBackgroundEffect(item)}
                />
              ))}
            </View>
          </View>
        </SettingsGroup>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  pickerBlock: {
    paddingTop: 12,
    paddingBottom: 14,
    gap: 10,
  },
  pickerTitle: {
    fontSize: 17,
    paddingHorizontal: 16,
  },
  pickerRow: {
    paddingHorizontal: 14,
    gap: 8,
    alignItems: 'center',
  },
  tileHit: {
    width: TILE_W + 6,
    height: TILE_H + 6,
    borderRadius: TILE_RADIUS + 4,
    borderWidth: 2,
    padding: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tile: {
    width: TILE_W,
    height: TILE_H,
    borderRadius: TILE_RADIUS,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  customEmpty: {
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderStyle: 'dashed',
    backgroundColor: 'transparent',
  },
  effectBlock: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 8,
  },
  effectTitle: { fontSize: 17 },
  effectHint: { fontSize: 13, lineHeight: 18 },
  segments: {
    flexDirection: 'row',
    alignItems: 'stretch',
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    minHeight: 36,
  },
  segment: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 36,
    paddingHorizontal: 2,
  },
  segmentJoin: {
    borderRightWidth: StyleSheet.hairlineWidth,
  },
  segmentLabel: {
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
  },
});
