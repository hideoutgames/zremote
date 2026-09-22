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

function RowActions({
  model,
  row,
  selected,
  onDelete,
  onInstalled,
}: {
  model: VoiceModelCatalogEntry;
  row: VoiceModelRowState;
  selected: string | null;
  onDelete: (model: VoiceModelCatalogEntry) => void;
  onInstalled: (model: VoiceModelCatalogEntry) => void;
}) {
  const theme = useTheme();
  const installed = row.state === 'installed';
  const downloading = row.state === 'downloading' || row.state === 'verifying';
  const canDownload = !installed && !downloading && model.productionPinned;

  // One action per row-state.
  const action:
    | { label: string; color: string; onPress: () => void; testID: string }
    | undefined =
    row.state === 'failed'
      ? {
          label: t('settings.voiceRetry'),
          color: theme.accent,
          onPress: () => {
            const manager = getVoiceModelManager();
            if (manager === undefined) return;
            manager.download(model.id).catch(() => {});
          },
          testID: `settings-model-download-${model.id}`,
        }
      : installed
      ? {
          label: t('settings.voiceDelete'),
          color: theme.danger,
          onPress: () => onDelete(model),
          testID: `settings-model-delete-${model.id}`,
        }
      : downloading
      ? {
          label: t('common.cancel'),
          color: theme.accent,
          onPress: () => getVoiceModelManager()?.cancelDownload(model.id),
          testID: `settings-model-cancel-${model.id}`,
        }
      : canDownload
      ? {
          label: t('settings.voiceDownload'),
          color: theme.accent,
          onPress: () => {
            const manager = getVoiceModelManager();
            if (manager === undefined) return;
            manager
              .download(model.id)
              .then(() => onInstalled(model))
              .catch(() => {});
          },
          testID: `settings-model-download-${model.id}`,
        }
      : undefined;

  return (
    <View style={styles.actions}>
      {action !== undefined ? (
        <Pressable
          onPress={action.onPress}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={action.label}
          testID={action.testID}
        >
          <Text style={[styles.action, { color: action.color }]}>
            {action.label}
          </Text>
        </Pressable>
      ) : null}
      {installed && selected === model.id ? (
        <Icon name="checkmark" size={16} color={theme.accent} />
      ) : null}
    </View>
  );
}

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

  const confirmDelete = useCallback(
    (model: VoiceModelCatalogEntry) => {
      const manager = getVoiceModelManager();
      if (manager === undefined) return;
      const affects =
        (kind === 'transcription' && selectedVoice === model.id) ||
        (kind === 'cleanup' && selectedCleanup === model.id);
      const del = () => {
        if (affects) {
          // Deselect first: the mounted runtime holds an in-use mark until
          // its effect re-runs — drop it now or delete() throws 'in use'.
          if (kind === 'transcription') setVoiceModelId(null);
          else setCleanupModelId(null);
          manager.release(model.id);
        }
        manager.delete(model.id).catch(() => {
          Alert.alert(
            t('settings.voiceDeleteTitle'),
            t('settings.voiceFailed'),
          );
        });
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
          const trailing = (
            <RowActions
              model={model}
              row={row}
              selected={selected}
              onDelete={confirmDelete}
              onInstalled={m => {
                // First install of a kind selects it automatically.
                if (selected === null) {
                  if (m.kind === 'transcription') setVoiceModelId(m.id);
                  else setCleanupModelId(m.id);
                }
              }}
            />
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
