// Composer model chip: harness brand mark + model label + chevron. Tap opens a
// Liquid Glass dropdown of up to 3 recent/catalog models plus More.

import React from 'react';
import { Pressable } from 'react-native';
import * as DropdownMenu from './menus/dropdown-menu';
import { ComposerMenuChip } from './ComposerMenuChip';
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
          hitSlop={4}
          accessibilityRole="button"
          accessibilityLabel={modelLabel}
        >
          <ComposerMenuChip
            label={modelLabel}
            color={theme.text}
            chevronColor={theme.textSecondary}
            leading={
              <HarnessMark harnessId={harnessId} size={14} color={theme.text} />
            }
          />
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
