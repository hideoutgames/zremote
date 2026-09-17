import React from 'react';
import { StyleSheet } from 'react-native';
import * as DropdownMenu from 'zeego/dropdown-menu';
import { Glass } from './Glass';
import { Icon } from './Icon';
import { theme } from '../theme';
import { t } from '../i18n/strings';

const CIRCLE = 44;

type AttachmentMenuProps = {
  onPickPhotos: () => void;
  /** Files/camera are staged-only this stage; the alert lives in the caller. */
  onUnavailable?: () => void;
};

export function AttachmentMenu({
  onPickPhotos,
  onUnavailable,
}: AttachmentMenuProps) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger>
        <Glass interactive style={styles.circle}>
          <Icon name="plus" size={22} color={theme.text} />
        </Glass>
      </DropdownMenu.Trigger>
      <DropdownMenu.Content>
        <DropdownMenu.Item key="camera" onSelect={onUnavailable ?? (() => {})}>
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
        <DropdownMenu.Item key="files" onSelect={onUnavailable ?? (() => {})}>
          <DropdownMenu.ItemTitle>{t('composer.files')}</DropdownMenu.ItemTitle>
          <DropdownMenu.ItemIcon ios={{ name: 'paperclip' }} />
        </DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  );
}

const styles = StyleSheet.create({
  circle: {
    width: CIRCLE,
    height: CIRCLE,
    borderRadius: CIRCLE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
});
