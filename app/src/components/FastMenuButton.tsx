// Composer Fast control: outline/filled bolt. Dropdown is On/Off, or the
// catalog's extra choices when the provider exposes more than a binary switch.

import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import * as DropdownMenu from './menus/dropdown-menu';
import { Icon } from './Icon';
import { useTheme } from '../theme';
import { t } from '../i18n/strings';
import type { ModelOption } from '../zeron/protocol/types';
import { fastOffChoice, fastOnChoice, isFastOffChoice } from './fastMode';

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
  const items =
    option !== undefined && multi
      ? option.choices
      : [
          {
            id: option !== undefined ? fastOnChoice(option) : 'on',
            label: t('common.on'),
          },
          {
            id: option !== undefined ? fastOffChoice(option) : 'off',
            label: t('common.off'),
          },
        ];
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
          style={styles.hit}
        >
          <View style={styles.iconWrap}>
            <Icon
              name={enabled ? 'bolt.fill' : 'bolt'}
              size={16}
              color={color}
            />
          </View>
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

const styles = StyleSheet.create({
  hit: {
    height: 32,
    minWidth: 32,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  iconWrap: {
    width: 22,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
