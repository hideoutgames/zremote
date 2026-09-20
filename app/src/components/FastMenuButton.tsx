// Composer Fast control: outline/filled bolt + trailing chevron, matching
// the model/effort chips. Dropdown is Normal plus the provider's Fast
// choice(s), or the catalog's extra named choices when there are more
// than a binary switch.

import React from 'react';
import { Pressable } from 'react-native';
import * as DropdownMenu from './menus/dropdown-menu';
import { Icon } from './Icon';
import { ComposerMenuChip } from './ComposerMenuChip';
import { useTheme } from '../theme';
import { t } from '../i18n/strings';
import type { ModelOption } from '../zeron/protocol/types';
import {
  fastMenuItems,
  fastOffChoice,
  fastOnChoice,
  isFastOffChoice,
} from './fastMode';

export function FastMenuButton({
  enabled,
  option,
  value,
  onSelect,
}: {
  enabled: boolean;
  option?: ModelOption;
  value?: string;
  onSelect: (choiceId: string) => void;
}) {
  const theme = useTheme();
  const color = enabled ? theme.fastAccent : theme.text;
  const multi = (option?.choices.length ?? 0) > 2;
  const items = fastMenuItems(option);
  const selectedId =
    value ??
    (enabled
      ? option !== undefined
        ? fastOnChoice(option)
        : 'on'
      : option !== undefined
      ? fastOffChoice(option)
      : 'off');

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger>
        <Pressable
          hitSlop={4}
          accessibilityRole="button"
          accessibilityLabel={t('picker.fastMode')}
          accessibilityState={{ selected: enabled }}
        >
          <ComposerMenuChip
            color={color}
            chevronColor={theme.textSecondary}
            leading={
              <Icon
                name={enabled ? 'bolt.fill' : 'bolt'}
                size={16}
                color={color}
              />
            }
          />
        </Pressable>
      </DropdownMenu.Trigger>
      <DropdownMenu.Content>
        {items.map(item => {
          const selected = multi
            ? item.id === selectedId
            : isFastOffChoice(item.id)
            ? !enabled
            : enabled;
          return (
            <DropdownMenu.Item key={item.id} onSelect={() => onSelect(item.id)}>
              <DropdownMenu.ItemTitle>{item.label}</DropdownMenu.ItemTitle>
              {selected ? (
                <DropdownMenu.ItemIcon ios={{ name: 'checkmark' }} />
              ) : null}
            </DropdownMenu.Item>
          );
        })}
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  );
}
