// Composer model chip: harness brand mark + model label. Tap opens a
// Liquid Glass dropdown of up to 3 recent/catalog models plus More.

import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import * as DropdownMenu from 'zeego/dropdown-menu';
import { HarnessMark } from './HarnessMark';
import { useTheme } from '../theme';
import { t } from '../i18n/strings';
import type { CatalogModelRef } from '../zeron/state/recentModels';

export function ModelMenuButton({
  harnessId,
  modelLabel,
  items,
  onPick,
  onMore,
}: {
  harnessId: string | undefined;
  modelLabel: string;
  items: readonly CatalogModelRef[];
  onPick: (harness: string, model: string) => void;
  onMore: () => void;
}) {
  const theme = useTheme();
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger>
        <Pressable
          style={[styles.chip, { backgroundColor: theme.inputBackground }]}
          hitSlop={4}
          accessibilityRole="button"
          accessibilityLabel={modelLabel}
        >
          <HarnessMark harnessId={harnessId} size={14} color={theme.text} />
          <Text style={[styles.text, { color: theme.text }]} numberOfLines={1}>
            {modelLabel}
          </Text>
        </Pressable>
      </DropdownMenu.Trigger>
      <DropdownMenu.Content>
        {items.map(item => (
          <DropdownMenu.Item
            key={`${item.harness}:${item.model}`}
            onSelect={() => onPick(item.harness, item.model)}
          >
            <DropdownMenu.ItemTitle>{item.label}</DropdownMenu.ItemTitle>
          </DropdownMenu.Item>
        ))}
        <DropdownMenu.Item key="more" onSelect={onMore}>
          <DropdownMenu.ItemTitle>{t('picker.more')}</DropdownMenu.ItemTitle>
        </DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 32,
    borderRadius: 16,
    paddingHorizontal: 10,
    gap: 6,
  },
  text: { fontSize: 13, maxWidth: 160 },
});
