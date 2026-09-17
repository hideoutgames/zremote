import React from 'react';
import { Pressable, StyleSheet } from 'react-native';
import * as DropdownMenu from 'zeego/dropdown-menu';
import { Icon } from './Icon';
import { theme } from '../theme';
import { t } from '../i18n/strings';

type AttachmentMenuProps = {
  onPickPhotos: () => void;
  onPickCamera: () => void;
  onPickFiles: () => void;
};

export function AttachmentMenu({
  onPickPhotos,
  onPickCamera,
  onPickFiles,
}: AttachmentMenuProps) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger>
        <Pressable
          hitSlop={6}
          style={styles.btn}
          accessibilityLabel={t('composer.attach')}
        >
          <Icon name="plus" size={22} color={theme.text} />
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
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  );
}

const styles = StyleSheet.create({
  btn: { padding: 4 },
});
