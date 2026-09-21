// Shared long-press menu: sent-at label + Copy, with the SF Symbol used
// by iOS copy. Returns a ContextMenu.Content *element* so zeego's
// pickChildren can see it as a direct Root child (a wrapper component
// would hide the items).

import React from 'react';
import * as Clipboard from 'expo-clipboard';
import * as ContextMenu from '../menus/context-menu';
import { t } from '../../i18n/strings';

export const formatMessageSentAt = (
  atMs: number,
  options?: { locale?: string; timeZone?: string },
): string => {
  if (!Number.isFinite(atMs) || atMs <= 0) return '';
  return new Date(atMs).toLocaleString(options?.locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: options?.timeZone,
  });
};

export function messageCopyContent(
  text: string,
  createdAt: number,
): React.ReactElement {
  const sentAt = formatMessageSentAt(createdAt);
  return (
    <ContextMenu.Content>
      {sentAt !== '' ? <ContextMenu.Label>{sentAt}</ContextMenu.Label> : null}
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
