import React from 'react';
import { Pressable, StyleSheet } from 'react-native';
import * as DropdownMenu from './menus/dropdown-menu';
import { Icon } from './Icon';
import { useTheme } from '../theme';
import { t } from '../i18n/strings';

type AttachmentMenuProps = {
  onPickPhotos: () => void;
  onPickCamera: () => void;
  onPickFiles: () => void;
  planEnabled?: boolean;
  onTogglePlan?: (enabled: boolean) => void;
};

export function AttachmentMenu({
  onPickPhotos,
  onPickCamera,
  onPickFiles,
  planEnabled = false,
  onTogglePlan,
}: AttachmentMenuProps) {
  const theme = useTheme();
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger>
        <Pressable
          hitSlop={6}
          style={[styles.btn, { backgroundColor: theme.inputBackground }]}
          accessibilityLabel={t('composer.attach')}
        >
          <Icon name="plus" size={18} color={theme.text} />
        </Pressable>
      </DropdownMenu.Trigger>
      <DropdownMenu.Content>
        <DropdownMenu.Item key="camera" onSelect={onPickCamera}>
          <DropdownMenu.ItemTitle>
            {t('composer.camera')}
          </DropdownMenu.ItemTitle>
          <DropdownMenu.ItemIcon ios={{ name: 'camera' }} />
        </DropdownMenu.Item>
        <DropdownMenu.Item key="photos" onSelect={onPickPhotos}>
          <DropdownMenu.ItemTitle>
            {t('composer.photos')}
          </DropdownMenu.ItemTitle>
          <DropdownMenu.ItemIcon ios={{ name: 'photo' }} />
        </DropdownMenu.Item>
        <DropdownMenu.Item key="files" onSelect={onPickFiles}>
          <DropdownMenu.ItemTitle>{t('composer.files')}</DropdownMenu.ItemTitle>
          <DropdownMenu.ItemIcon ios={{ name: 'paperclip' }} />
        </DropdownMenu.Item>
        {onTogglePlan !== undefined ? (
          <DropdownMenu.CheckboxItem
            key="plan"
            value={planEnabled}
            onValueChange={next => {
              onTogglePlan(next === 'on');
            }}
          >
            <DropdownMenu.ItemTitle>
              {t('composer.plan')}
            </DropdownMenu.ItemTitle>
            <DropdownMenu.ItemIcon ios={{ name: 'list.bullet.indent' }} />
            <DropdownMenu.ItemIndicator />
          </DropdownMenu.CheckboxItem>
        ) : null}
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  );
}

const styles = StyleSheet.create({
  // 32pt subtle-fill circle inside the composer's single glass surface
  // (44pt hit target comes from the hitSlop, matching the sibling controls).
  btn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
