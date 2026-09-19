// Settings → Appearance: session wallpaper picker + effect chips. Copy
// tracks desktop Settings → Appearance for the picker/effects; the image
// now fills the window behind Home, chats, and compose.

import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { launchImageLibrary } from 'react-native-image-picker';
import { Icon } from '../Icon';
import { SettingsGroup, SettingsRow } from './SettingsList';
import {
  COLOR_SCHEME_PREFERENCES,
  useTheme,
  type ColorSchemePreference,
} from '../../theme';
import { t, type StringKey } from '../../i18n/strings';
import {
  installNewThreadComposerBackground,
  removeNewThreadComposerBackground,
  setColorSchemePreference,
  setNewThreadBackgroundEffect,
  useColorSchemePreference,
  useNewThreadBackgroundEffect,
  useNewThreadComposerBackground,
} from '../../zeron/state/uiPrefs';
import {
  NEW_THREAD_BACKGROUND_EFFECTS,
  backgroundFileExists,
  type NewThreadBackgroundEffect,
} from '../../zeron/state/newThreadBackground';
import { createLog } from '../../zeron/log';

const log = createLog();

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

function EffectChip({
  effect,
  selected,
  onPress,
}: {
  effect: NewThreadBackgroundEffect;
  selected: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      hitSlop={4}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={t(EFFECT_LABEL[effect])}
      testID={`settings-background-effect-${effect}`}
      style={[
        styles.chip,
        {
          backgroundColor: selected ? theme.accent : theme.cardBackground,
          borderColor: selected ? theme.accent : theme.border,
        },
      ]}
    >
      <Text
        style={[
          styles.chipLabel,
          { color: theme.text },
          selected ? styles.chipLabelOn : null,
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

export function AppearanceBackground({
  onOpenTheme,
}: {
  onOpenTheme: () => void;
}) {
  const theme = useTheme();
  const colorScheme = useColorSchemePreference();
  const background = useNewThreadComposerBackground();
  const effect = useNewThreadBackgroundEffect();
  const [available, setAvailable] = useState(true);

  useEffect(() => {
    if (background === undefined) {
      setAvailable(true);
      return;
    }
    let cancelled = false;
    backgroundFileExists(background.uri)
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

  const onRemove = useCallback(() => {
    removeNewThreadComposerBackground().catch(e =>
      log.warn(`background remove: ${e}`),
    );
  }, []);

  const subtitle =
    background === undefined
      ? t('settings.backgroundEmpty')
      : available
      ? `${background.name}\n${t('settings.backgroundFrostHint')}`
      : `${t('settings.backgroundUnavailable')}\n${t(
          'settings.backgroundUnavailableHint',
        )}`;

  const trailing =
    background === undefined ? (
      <Pressable
        onPress={onChoose}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={t('settings.backgroundChoose')}
        testID="settings-background-choose"
      >
        <Text style={[styles.action, { color: theme.accent }]}>
          {t('settings.backgroundChoose')}
        </Text>
      </Pressable>
    ) : (
      <View style={styles.actions}>
        <Pressable
          onPress={onChoose}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t('settings.backgroundReplace')}
          testID="settings-background-replace"
        >
          <Text style={[styles.action, { color: theme.accent }]}>
            {t('settings.backgroundReplace')}
          </Text>
        </Pressable>
        <Pressable
          onPress={onRemove}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t('settings.backgroundRemove')}
          testID="settings-background-remove"
        >
          <Text style={[styles.action, { color: theme.danger }]}>
            {t('settings.backgroundRemove')}
          </Text>
        </Pressable>
      </View>
    );

  return (
    <>
      <SettingsGroup header={t('settings.appearance')}>
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
        <SettingsRow
          title={t('settings.background')}
          subtitle={subtitle}
          titleNumberOfLines={2}
          leading={
            background !== undefined && available ? (
              <Image
                source={{ uri: background.uri }}
                style={styles.thumb}
                contentFit="cover"
                testID="settings-background-thumb"
              />
            ) : (
              <Icon name="photo" size={22} color={theme.textSecondary} />
            )
          }
          trailing={trailing}
          testID="settings-background"
          accessibilityLabel={t('settings.background')}
        />
      </SettingsGroup>
      {background !== undefined && available ? (
        <SettingsGroup>
          <View style={styles.effectBlock} testID="settings-background-effects">
            <Text style={[styles.effectTitle, { color: theme.text }]}>
              {t('settings.backgroundEffect')}
            </Text>
            <Text style={[styles.effectHint, { color: theme.textSecondary }]}>
              {t(EFFECT_HINT[effect])}
            </Text>
            <View style={styles.chips}>
              {NEW_THREAD_BACKGROUND_EFFECTS.map(item => (
                <EffectChip
                  key={item}
                  effect={item}
                  selected={item === effect}
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
  thumb: {
    width: 29,
    height: 29,
    borderRadius: 6,
    overflow: 'hidden',
  },
  actions: { gap: 8, alignItems: 'flex-end' },
  action: { fontSize: 15, fontWeight: '500' },
  effectBlock: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 8,
  },
  effectTitle: { fontSize: 17 },
  effectHint: { fontSize: 13, lineHeight: 18 },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    justifyContent: 'flex-end',
  },
  chip: {
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingVertical: 6,
    minHeight: 32,
    justifyContent: 'center',
  },
  chipLabel: { fontSize: 13, fontWeight: '600' },
  chipLabelOn: { color: '#FFFFFF' },
});
