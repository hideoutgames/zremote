// Composer model chip: harness brand mark + model label + chevron. Tap opens a
// Liquid Glass dropdown of pinned models or recents (up to 3), plus More.
// Compose groups pins by provider; a session menu stays flat and same-harness.

import React from 'react';
import { Pressable } from 'react-native';
import * as DropdownMenu from './menus/dropdown-menu';
import { ComposerMenuChip } from './ComposerMenuChip';
import { HarnessMark } from './HarnessMark';
import { imageForHarness } from './harnessBrand';
import { useTheme } from '../theme';
import { t } from '../i18n/strings';
import type { CatalogModelRef } from '../zeron/state/recentModels';
import { groupMenuModelsByProvider } from '../zeron/state/pinnedModels';

const modelMenuItem = (
  item: CatalogModelRef,
  onPick: (harness: string, model: string) => void,
) => {
  const source = imageForHarness(item.harness);
  return (
    <DropdownMenu.Item
      key={`${item.harness}:${item.model}`}
      onSelect={() => onPick(item.harness, item.model)}
    >
      {source !== undefined ? (
        <DropdownMenu.ItemImage
          source={source}
          ios={{ style: { renderingMode: 'template' } }}
        />
      ) : null}
      <DropdownMenu.ItemTitle>{item.label}</DropdownMenu.ItemTitle>
    </DropdownMenu.Item>
  );
};

export function ModelMenuButton({
  harnessId,
  modelLabel,
  items,
  onPick,
  onMore,
  groupByProvider = false,
}: {
  harnessId: string | undefined;
  modelLabel: string;
  items: readonly CatalogModelRef[];
  onPick: (harness: string, model: string) => void;
  onMore: () => void;
  groupByProvider?: boolean;
}) {
  const theme = useTheme();
  const groups =
    groupByProvider && items.some(i => i.harnessName)
      ? groupMenuModelsByProvider(items)
      : undefined;
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
        {groups !== undefined
          ? groups.map(group => (
              <DropdownMenu.Group key={group.harness}>
                <DropdownMenu.Label>{group.label}</DropdownMenu.Label>
                {group.items.map(item => modelMenuItem(item, onPick))}
              </DropdownMenu.Group>
            ))
          : items.map(item => modelMenuItem(item, onPick))}
        <DropdownMenu.Item key="more" onSelect={onMore}>
          <DropdownMenu.ItemTitle>{t('picker.more')}</DropdownMenu.ItemTitle>
        </DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  );
}
