import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon } from '../Icon';
import { useTheme } from '../../theme';
import { t } from '../../i18n/strings';
import type { TurnChange } from './turnChanges';
import { fileKindIcon } from './turnChanges';

const leaf = (path: string): string =>
  path.split(/[\\/]/).filter(Boolean).pop() ?? path;

export function TurnChangesCard({
  files,
  onOpenFile,
  embedded = false,
}: {
  files: TurnChange[];
  onOpenFile: (file: TurnChange) => void;
  embedded?: boolean;
}) {
  const theme = useTheme();
  if (files.length === 0) return null;
  return (
    <View
      style={[
        styles.card,
        embedded ? styles.embedded : undefined,
        embedded
          ? undefined
          : {
              backgroundColor: theme.cardBackground,
              borderColor: theme.border,
            },
      ]}
    >
      <Text
        style={[styles.heading, { color: theme.text }]}
        accessibilityRole="header"
      >
        {t('session.changes')}
      </Text>
      {files.map(file => (
        <Pressable
          key={file.path}
          onPress={() => onOpenFile(file)}
          accessibilityRole="button"
          accessibilityLabel={leaf(file.path)}
          style={styles.row}
        >
          <Icon
            name={fileKindIcon(file.path)}
            size={16}
            color={theme.textSecondary}
          />
          <Text style={[styles.name, { color: theme.text }]} numberOfLines={1}>
            {leaf(file.path)}
          </Text>
          {file.additions > 0 || file.deletions > 0 ? (
            <Text style={styles.stats}>
              {file.additions > 0 ? (
                <Text style={{ color: theme.diffAddText }}>
                  +{file.additions}
                </Text>
              ) : null}
              {file.additions > 0 && file.deletions > 0 ? ' ' : null}
              {file.deletions > 0 ? (
                <Text style={{ color: theme.diffDelText }}>
                  -{file.deletions}
                </Text>
              ) : null}
            </Text>
          ) : null}
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 6,
    marginTop: 10,
  },
  heading: {
    fontSize: 13,
    fontWeight: '600',
    paddingBottom: 4,
  },
  embedded: {
    borderWidth: 0,
    paddingHorizontal: 0,
    marginTop: 0,
    backgroundColor: 'transparent',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
  },
  name: { flex: 1, fontSize: 15 },
  stats: { fontSize: 13, fontWeight: '600', fontVariant: ['tabular-nums'] },
});
