import React from 'react';
import { SettingsGroup, SettingsRow } from './SettingsList';
import { Icon } from '../Icon';
import { useTheme } from '../../theme';
import { t } from '../../i18n/strings';
import {
  setVoiceInputMode,
  useVoiceInputMode,
} from '../../zeron/state/uiPrefs';
import {
  VOICE_INPUT_MODES,
  type VoiceInputMode,
} from '../../zeron/voice/types';
import type { StringKey } from '../../i18n/strings';

const MODE_LABEL: Record<VoiceInputMode, StringKey> = {
  dictation: 'settings.voiceInput.dictation',
  voiceModel: 'settings.voiceInput.voiceModel',
  disabled: 'settings.voiceInput.disabled',
};

export function VoiceInputPage() {
  const theme = useTheme();
  const mode = useVoiceInputMode();
  return (
    <SettingsGroup header={t('settings.voiceInput')}>
      {VOICE_INPUT_MODES.map(item => (
        <SettingsRow
          key={item}
          title={t(MODE_LABEL[item])}
          trailing={
            mode === item ? (
              <Icon name="checkmark" size={16} color={theme.accent} />
            ) : undefined
          }
          onPress={() => setVoiceInputMode(item)}
          testID={`settings-voice-mode-${item}`}
          accessibilityLabel={t(MODE_LABEL[item])}
        />
      ))}
    </SettingsGroup>
  );
}

export const voiceInputModeLabel = (mode: VoiceInputMode): string =>
  t(MODE_LABEL[mode]);
