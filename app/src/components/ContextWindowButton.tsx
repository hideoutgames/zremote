// Composer context-window control: the selected catalog choice plus a
// chevron. Dropdown lists every choice the model advertises. Distinct from
// the read-only context-usage meter.

import React from 'react';
import { Pressable } from 'react-native';
import * as DropdownMenu from './menus/dropdown-menu';
import { ComposerMenuChip } from './ComposerMenuChip';
import { useTheme } from '../theme';
import { t } from '../i18n/strings';
import type { ModelOption } from '../zeron/protocol/types';
import { contextChoiceLabel } from './contextWindow';

export function ContextWindowButton({
  option,
  value,
  onSelect,
  limitWidth = true,
}: {
  option: ModelOption;
  value?: string;
  onSelect: (choiceId: string) => void;
  limitWidth?: boolean;
}) {
  const theme = useTheme();
  const selected =
    value !== undefined && option.choices.some(c => c.id === value)
      ? value
      : option.defaultChoice;
  const label = contextChoiceLabel(option, selected);

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger>
        <Pressable
          hitSlop={4}
          accessibilityRole="button"
          accessibilityLabel={`${t('picker.contextWindow')}, ${label}`}
        >
          <ComposerMenuChip
            label={label}
            color={theme.text}
            chevronColor={theme.textSecondary}
            limitWidth={limitWidth}
          />
        </Pressable>
      </DropdownMenu.Trigger>
      <DropdownMenu.Content>
        {option.choices.map(choice => (
          <DropdownMenu.Item
            key={choice.id}
            onSelect={() => onSelect(choice.id)}
          >
            <DropdownMenu.ItemTitle>
              {contextChoiceLabel(option, choice.id)}
            </DropdownMenu.ItemTitle>
            {choice.id === selected ? (
              <DropdownMenu.ItemIcon ios={{ name: 'checkmark' }} />
            ) : null}
          </DropdownMenu.Item>
        ))}
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  );
}
