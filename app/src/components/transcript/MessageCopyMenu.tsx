// Shared long-press menu: Copy only, with the SF Symbol used by iOS copy.

import React from 'react';
import * as Clipboard from 'expo-clipboard';
import * as ContextMenu from '../menus/context-menu';
import { t } from '../../i18n/strings';

export function MessageCopyMenu({ text }: { text: string }) {
  return (
    <ContextMenu.Content>
      <ContextMenu.Item
        key="copy"
        onSelect={() => Clipboard.setStringAsync(text).catch(() => {})}
      >
        <ContextMenu.ItemTitle>{t('common.copy')}</ContextMenu.ItemTitle>
        <ContextMenu.ItemIcon ios={{ name: 'doc.on.doc' }} />
      </ContextMenu.Item>
    </ContextMenu.Content>
  );
}
