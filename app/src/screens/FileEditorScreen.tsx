// File editor — monospace TextInput over ReadWorkspaceFile, saved through
// WriteWorkspaceFile with the engine's optimistic-concurrency fields
// (expectedCheckoutId + expectedContentHash, entities.rs L592-624). A
// 'conflict' outcome surfaces as "File changed on host — reload or
// overwrite?". Images render via ReadWorkspaceImage → NitroImage (base64).

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { NitroImage } from 'react-native-nitro-image';
import type { WorkspaceFilesClient } from '../zeron/files/filesClient';
import type {
  WorkspaceFileText,
  WorkspaceTarget,
} from '../zeron/protocol/types';
import { useTheme } from '../theme';
import { t } from '../i18n/strings';
import { Icon } from '../components/Icon';

export function FileEditorScreen({
  client,
  target,
  path,
  onClose,
  image,
}: {
  client: WorkspaceFilesClient;
  target: WorkspaceTarget;
  path: string;
  onClose: () => void;
  image?: boolean;
}) {
  const theme = useTheme();
  const [file, setFile] = useState<WorkspaceFileText | undefined>(undefined);
  const [imageUri, setImageUri] = useState<string | undefined>(undefined);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    setError(undefined);
    if (image === true) {
      client
        .readImage(target, path, '')
        .then(chunk =>
          setImageUri(`data:${chunk.mimeType};base64,${chunk.data}`),
        )
        .catch(e => setError(String(e?.message ?? e)));
      return;
    }
    client
      .readFile(target, path)
      .then(f => {
        setFile(f);
        setText(f.text ?? '');
        setDirty(false);
      })
      .catch(e => setError(String(e?.message ?? e)));
  }, [client, target, path, image]);

  useEffect(load, [load]);

  const save = useCallback(
    (force?: boolean) => {
      if (file === undefined || saving) return;
      setSaving(true);
      client
        .writeFile(target, {
          expectedCheckoutId: file.checkoutId,
          path,
          text,
          expectedContentHash:
            force === true ? file.contentHash ?? '' : file.contentHash ?? '',
          encoding: file.encoding === 'utf8Bom' ? 'utf8Bom' : 'utf8',
          lineEnding: file.lineEnding === 'crlf' ? 'crlf' : 'lf',
        })
        .then(outcome => {
          setSaving(false);
          if (outcome.status === 'written') {
            setDirty(false);
            setFile(f =>
              f === undefined
                ? f
                : { ...f, contentHash: outcome.file.contentHash },
            );
          } else {
            Alert.alert(t('files.conflict'), outcome.reason, [
              { text: t('files.reload'), onPress: load },
              { text: t('session.cancel'), style: 'cancel' },
            ]);
          }
        })
        .catch(e => {
          setSaving(false);
          setError(String(e?.message ?? e));
        });
    },
    [client, file, path, text, saving, target, load],
  );

  const lineCount = text === '' ? 0 : text.split('\n').length;
  const readOnly = file?.readOnlyReason !== undefined;

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      <View style={[styles.bar, { borderBottomColor: theme.border }]}>
        <Pressable
          onPress={onClose}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t('session.back')}
          style={styles.barBtn}
        >
          <Icon name="chevron.left" size={16} color={theme.text} />
        </Pressable>
        <Text
          style={[styles.name, { color: theme.text }]}
          numberOfLines={1}
          maxFontSizeMultiplier={1.6}
          accessibilityLabel={path}
        >
          {path}
          {dirty ? ` · ${t('files.unsaved')}` : ''}
        </Text>
        {image !== true && !readOnly ? (
          <Pressable
            onPress={() => save()}
            disabled={!dirty || saving}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t('files.save')}
            accessibilityState={{ disabled: !dirty || saving }}
            style={styles.barBtn}
          >
            <Text
              style={[
                styles.saveText,
                { color: dirty ? theme.accent : theme.textSecondary },
                dirty ? undefined : styles.saveDim,
              ]}
            >
              {t('files.save')}
            </Text>
          </Pressable>
        ) : null}
      </View>
      {image === true ? (
        imageUri !== undefined ? (
          <NitroImage
            image={{ url: imageUri }}
            style={styles.image}
            resizeMode="contain"
          />
        ) : (
          <Centered>
            {error !== undefined ? (
              <Text style={{ color: theme.danger }}>{error}</Text>
            ) : (
              <ActivityIndicator />
            )}
          </Centered>
        )
      ) : file === undefined ? (
        <Centered>
          {error !== undefined ? (
            <Text style={{ color: theme.danger }}>{error}</Text>
          ) : (
            <ActivityIndicator />
          )}
        </Centered>
      ) : (
        <>
          <TextInput
            value={text}
            onChangeText={v => {
              setText(v);
              setDirty(true);
            }}
            multiline
            editable={!readOnly}
            style={[styles.editor, { color: theme.text }]}
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel={path}
            accessibilityState={{ disabled: readOnly }}
          />
          <Text
            style={[styles.footer, { color: theme.textSecondary }]}
            maxFontSizeMultiplier={1.6}
          >
            {`${lineCount} ${t('files.lines')}`}
            {readOnly ? ` · ${t('files.readOnly')}` : ''}
            {file.truncated ? ' · truncated' : ''}
          </Text>
        </>
      )}
    </View>
  );
}

const Centered = ({ children }: { children: React.ReactNode }) => (
  <View style={styles.centered}>{children}</View>
);

const styles = StyleSheet.create({
  root: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  barBtn: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: { flex: 1, fontSize: 14 },
  editor: {
    flex: 1,
    fontFamily: 'monospace',
    fontSize: 13,
    padding: 12,
    textAlignVertical: 'top',
  },
  image: { flex: 1 },
  footer: { fontSize: 11, paddingHorizontal: 12, paddingVertical: 6 },
  saveText: {},
  saveDim: { opacity: 0.4 },
});
