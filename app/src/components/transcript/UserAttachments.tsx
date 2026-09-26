// Transcript attachment chips. The host stores files as a prompt trailer
// (`Attached images|files (local files …)` plus `- path` lines), including
// unresolved `pending://` refs. Those render as the file — a thumbnail when
// we have bytes — and never as a tappable pending link.

import React, { useEffect, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import type { AttachmentBytes } from '../../zeron/attachments/read';
import { attachmentPreviewUri } from '../../zeron/attachments/previewCache';
import { isImageFileName } from '../../zeron/attachments/validate';
import { PENDING_REF_PREFIX } from '../../zeron/protocol/messages';
import type { UserMessageAttachment } from '../../zeron/protocol/messages';
import { Icon } from '../Icon';
import { useTheme } from '../../theme';

export type LoadAttachment = (path: string) => Promise<AttachmentBytes>;

const canFetch = (path: string): boolean =>
  path.startsWith('/') && !path.startsWith(PENDING_REF_PREFIX);

function AttachmentView({
  attachment,
  loadAttachment,
}: {
  attachment: UserMessageAttachment;
  loadAttachment?: LoadAttachment;
}) {
  'use no memo';
  const theme = useTheme();
  const localUri = attachmentPreviewUri(attachment.path);
  const [remoteUri, setRemoteUri] = useState<string | undefined>();
  const image = isImageFileName(attachment.name);
  const showImage =
    image && (localUri !== undefined || remoteUri !== undefined);

  useEffect(() => {
    if (!image || localUri !== undefined || loadAttachment === undefined)
      return;
    if (!canFetch(attachment.path)) return;
    let cancelled = false;
    loadAttachment(attachment.path)
      .then(bytes => {
        if (cancelled) return;
        if (!bytes.mimeType.toLowerCase().startsWith('image/')) return;
        if (bytes.base64 === '') return;
        setRemoteUri(`data:${bytes.mimeType};base64,${bytes.base64}`);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [attachment.path, image, loadAttachment, localUri]);

  if (showImage) {
    return (
      <Image
        testID="user-attachment"
        source={{ uri: localUri ?? remoteUri }}
        accessibilityLabel={attachment.name}
        style={[styles.thumb, { backgroundColor: theme.surface }]}
      />
    );
  }
  return (
    <View
      testID="user-attachment"
      style={[
        styles.chip,
        { backgroundColor: theme.surface, borderColor: theme.border },
      ]}
    >
      <Icon
        name={image ? 'photo' : 'doc'}
        size={13}
        color={theme.textSecondary}
      />
      <Text
        testID="user-attachment-name"
        style={[styles.name, { color: theme.text }]}
        numberOfLines={1}
      >
        {attachment.name}
      </Text>
    </View>
  );
}

export function UserAttachments({
  attachments,
  loadAttachment,
}: {
  attachments: readonly UserMessageAttachment[];
  loadAttachment?: LoadAttachment;
}) {
  if (attachments.length === 0) return null;
  return (
    <View testID="user-attachments" style={styles.row}>
      {attachments.map(attachment => (
        <AttachmentView
          key={`${attachment.path}:${attachment.name}`}
          attachment={attachment}
          loadAttachment={loadAttachment}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: 6,
    marginBottom: 4,
  },
  thumb: {
    width: 112,
    height: 80,
    borderRadius: 12,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 8,
    paddingVertical: 5,
    maxWidth: 180,
  },
  name: { fontSize: 12 },
});
