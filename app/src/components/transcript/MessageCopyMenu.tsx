// Shared long-press menu: Copy only, with the SF Symbol used by iOS copy.
// Returns a ContextMenu.Content *element* so zeego's pickChildren can see
// it as a direct Root child (a wrapper component would hide the items).

import React from 'react';
import * as Clipboard from 'expo-clipboard';
import * as ContextMenu from 'zeego/context-menu';
import { t } from '../../i18n/strings';

export function messageCopyContent(text: string): React.ReactElement {
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
