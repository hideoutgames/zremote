import React, { useCallback } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useStore } from 'zustand';
import { SettingsGroup, SettingsRow } from './SettingsList';
import { Icon } from '../Icon';
import { useTheme } from '../../theme';
import { t } from '../../i18n/strings';
import {
  setCleanupModelId,
  setVoiceModelId,
  useCleanupModelId,
  useVoiceModelId,
} from '../../zeron/state/uiPrefs';
import {
  catalogEntry,
  cleanupCatalog,
  formatModelBytes,
  transcriptionCatalog,
} from '../../zeron/voice/catalog';
import {
  getVoiceModelManager,
  voiceModelStore,
  type VoiceModelRowState,
} from '../../zeron/voice/manager';
import type { VoiceModelCatalogEntry } from '../../zeron/voice/types';

const errorCopy = (error?: string): string => {
  if (error === 'checksum') return t('settings.voiceFailedChecksum');
  if (error === 'storage') return t('settings.voiceFailedStorage');
  if (error === 'unpinned') return t('settings.voiceFailedUnpinned');
  if (error === 'interrupted') return t('settings.voiceFailedInterrupted');
  if (error !== undefined) return t('settings.voiceFailed');
  return t('settings.voiceNotDownloaded');
};

const subtitleFor = (
  model: VoiceModelCatalogEntry,
  row: VoiceModelRowState,
): string => {
  const size = formatModelBytes(model.bytes);
  if (row.state === 'downloading') {
    return `${t('settings.voiceDownloading')} · ${size}`;
  }
  if (row.state === 'verifying') return t('settings.voiceVerifying');
  if (row.state === 'installed') {
    return `${t('settings.voiceInstalled')} · ${size}`;
  }
  if (row.state === 'failed') return `${errorCopy(row.error)} · ${size}`;
  if (!model.productionPinned) {
    return `${t('settings.voiceFailedUnpinned')} · ${size}`;
  }
  return `${model.description} · ${size}`;
};

export function VoiceModelPicker({
  kind,
}: {
  kind: 'transcription' | 'cleanup';
}) {
  const theme = useTheme();
  const selectedVoice = useVoiceModelId();
  const selectedCleanup = useCleanupModelId();
  const byId = useStore(voiceModelStore, s => s.byId);
  const models =
    kind === 'transcription' ? transcriptionCatalog() : cleanupCatalog();
  const selected = kind === 'transcription' ? selectedVoice : selectedCleanup;

  const startDownload = (id: string) => {
    const manager = getVoiceModelManager();
    if (manager === undefined) return;
    manager.download(id).catch(() => {});
  };

  const confirmDelete = useCallback(
    (model: VoiceModelCatalogEntry) => {
      const manager = getVoiceModelManager();
      if (manager === undefined) return;
      const affects =
        (kind === 'transcription' && selectedVoice === model.id) ||
        (kind === 'cleanup' && selectedCleanup === model.id);
      const del = () => {
        manager
          .delete(model.id)
          .then(() => {
            if (kind === 'transcription' && selectedVoice === model.id) {
              setVoiceModelId(null);
            }
            if (kind === 'cleanup' && selectedCleanup === model.id) {
              setCleanupModelId(null);
            }
          })
          .catch(() => {});
      };
      if (!affects) {
        del();
        return;
      }
      Alert.alert(
        t('settings.voiceDeleteTitle'),
        t('settings.voiceDeleteSelected'),
        [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('settings.voiceDelete'),
            style: 'destructive',
            onPress: del,
          },
        ],
      );
    },
    [kind, selectedCleanup, selectedVoice],
  );

  return (
    <>
      {kind === 'cleanup' ? (
        <SettingsGroup>
          <SettingsRow
            title={t('settings.cleanupDisabled')}
            trailing={
              selected === null ? (
                <Icon name="checkmark" size={16} color={theme.accent} />
              ) : undefined
            }
            onPress={() => setCleanupModelId(null)}
            testID="settings-cleanup-disabled"
          />
        </SettingsGroup>
      ) : null}
      <SettingsGroup
        header={
          kind === 'transcription'
            ? t('settings.voiceModel')
            : t('settings.cleanupModel')
        }
      >
        {models.map(model => {
          const row = byId[model.id] ?? {
            state: 'notDownloaded' as const,
            progress: 0,
          };
          const installed = row.state === 'installed';
          const downloading =
            row.state === 'downloading' || row.state === 'verifying';
          const canDownload =
            !installed && !downloading && model.productionPinned;
          const trailing = (
            <View style={styles.actions}>
              {canDownload || row.state === 'failed' ? (
                <Pressable
                  onPress={() => startDownload(model.id)}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={
                    row.state === 'failed'
                      ? t('settings.voiceRetry')
                      : t('settings.voiceDownload')
                  }
                  testID={`settings-model-download-${model.id}`}
                >
                  <Text style={[styles.action, { color: theme.accent }]}>
                    {row.state === 'failed'
                      ? t('settings.voiceRetry')
                      : t('settings.voiceDownload')}
                  </Text>
                </Pressable>
              ) : null}
              {downloading ? (
                <Pressable
                  onPress={() =>
                    getVoiceModelManager()?.cancelDownload(model.id)
                  }
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={t('common.cancel')}
                  testID={`settings-model-cancel-${model.id}`}
                >
                  <Text style={[styles.action, { color: theme.accent }]}>
                    {t('common.cancel')}
                  </Text>
                </Pressable>
              ) : null}
              {installed ? (
                <Pressable
                  onPress={() => confirmDelete(model)}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={t('settings.voiceDelete')}
                  testID={`settings-model-delete-${model.id}`}
                >
                  <Text style={[styles.action, { color: theme.danger }]}>
                    {t('settings.voiceDelete')}
                  </Text>
                </Pressable>
              ) : null}
              {installed && selected === model.id ? (
                <Icon name="checkmark" size={16} color={theme.accent} />
              ) : null}
            </View>
          );
          return (
            <SettingsRow
              key={model.id}
              title={model.name}
              subtitle={subtitleFor(model, row)}
              progress={row.state === 'downloading' ? row.progress : undefined}
              trailing={trailing}
              onPress={
                installed
                  ? () => {
                      if (kind === 'transcription') setVoiceModelId(model.id);
                      else setCleanupModelId(model.id);
                    }
                  : undefined
              }
              testID={`settings-model-${model.id}`}
              accessibilityLabel={`${model.name}, ${subtitleFor(model, row)}`}
            />
          );
        })}
      </SettingsGroup>
    </>
  );
}

export const selectedModelLabel = (id: string | null): string => {
  if (id === null) return t('settings.cleanupDisabled');
  return catalogEntry(id)?.name ?? t('settings.voiceRequired');
};

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  action: { fontSize: 15, fontWeight: '500' },
});
