import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SettingsGroup, SettingsRow } from './SettingsList';
import { useTheme } from '../../theme';
import { t } from '../../i18n/strings';
import {
  setCleanupPromptOverride,
  useCleanupPromptOverride,
} from '../../zeron/state/uiPrefs';
import { DEFAULT_CLEANUP_PROMPT } from '../../zeron/voice/prompt';

export function CleanupPromptEditor({ onClose }: { onClose: () => void }) {
  const theme = useTheme();
  const stored = useCleanupPromptOverride();
  const [draft, setDraft] = useState(stored ?? DEFAULT_CLEANUP_PROMPT);

  return (
    <>
      <SettingsGroup footer={t('settings.cleanupInstructionsHint')}>
        <View style={styles.editorWrap}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            multiline
            textAlignVertical="top"
            style={[styles.editor, { color: theme.text }]}
            accessibilityLabel={t('settings.cleanupInstructions')}
            testID="settings-cleanup-prompt"
          />
        </View>
      </SettingsGroup>
      <SettingsGroup>
        <SettingsRow
          title={t('settings.cleanupRestoreDefault')}
          onPress={() => setDraft(DEFAULT_CLEANUP_PROMPT)}
          testID="settings-cleanup-restore"
        />
      </SettingsGroup>
      <View style={styles.actions}>
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={t('common.cancel')}
          testID="settings-cleanup-cancel"
          hitSlop={8}
        >
          <Text style={[styles.action, { color: theme.accent }]}>
            {t('common.cancel')}
          </Text>
        </Pressable>
        <Pressable
          onPress={() => {
            const trimmed = draft.trim();
            setCleanupPromptOverride(
              trimmed === DEFAULT_CLEANUP_PROMPT.trim() ? null : draft,
            );
            onClose();
          }}
          accessibilityRole="button"
          accessibilityLabel={t('settings.cleanupSave')}
          testID="settings-cleanup-save"
          hitSlop={8}
        >
          <Text style={[styles.action, { color: theme.accent }]}>
            {t('settings.cleanupSave')}
          </Text>
        </Pressable>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  editorWrap: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  editor: {
    minHeight: 220,
    fontSize: 17,
    lineHeight: 22,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 32,
    marginBottom: 24,
  },
  action: { fontSize: 17, fontWeight: '600' },
});
