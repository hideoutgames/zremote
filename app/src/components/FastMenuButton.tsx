// Composer Fast control: label + chevron, Liquid Glass dropdown of On/Off.

import React from 'react';
import { Pressable } from 'react-native';
import * as DropdownMenu from './menus/dropdown-menu';
import { ComposerMenuChip } from './ComposerMenuChip';
import { useTheme } from '../theme';
import { t } from '../i18n/strings';

export function FastMenuButton({
  enabled,
  onToggle,
}: {
  enabled: boolean;
  onToggle: (on: boolean) => void;
}) {
  const theme = useTheme();
  const color = enabled ? theme.fastAccent : theme.text;
  const chevron = enabled ? theme.fastAccent : theme.textSecondary;
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
            label={t('picker.fastMode')}
            color={color}
            chevronColor={chevron}
          />
        </Pressable>
      </DropdownMenu.Trigger>
      <DropdownMenu.Content>
        <DropdownMenu.Item key="on" onSelect={() => onToggle(true)}>
          <DropdownMenu.ItemTitle>{t('common.on')}</DropdownMenu.ItemTitle>
          {enabled ? (
            <DropdownMenu.ItemIcon ios={{ name: 'checkmark' }} />
          ) : null}
        </DropdownMenu.Item>
        <DropdownMenu.Item key="off" onSelect={() => onToggle(false)}>
          <DropdownMenu.ItemTitle>{t('common.off')}</DropdownMenu.ItemTitle>
          {!enabled ? (
            <DropdownMenu.ItemIcon ios={{ name: 'checkmark' }} />
          ) : null}
        </DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  );
}
