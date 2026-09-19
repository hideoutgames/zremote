// Horizontal square attachment tiles for the composer. Images show a
// cover thumbnail; other files show a document tile. Tap opens preview
// (parent); the corner × only removes.

import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { NitroImage } from 'react-native-nitro-image';
import { Icon } from './Icon';
import { t } from '../i18n/strings';
import { useTheme } from '../theme';
import { isImageMime } from '../zeron/attachments/validate';
import type { StagedAttachment } from '../zeron/state/draftStore';

export const ATTACHMENT_TILE = 72;

export function AttachmentStrip({
  attachments,
  onOpen,
  onRemove,
}: {
  attachments: readonly StagedAttachment[];
  onOpen: (attachment: StagedAttachment) => void;
  onRemove: (id: string) => void;
}) {
  const theme = useTheme();
  return (
    <ScrollView
      horizontal
      testID="attachment-strip"
      showsHorizontalScrollIndicator={false}
      style={styles.scroll}
      contentContainerStyle={styles.row}
    >
      {attachments.map(a => {
        const image = isImageMime(a.mimeType);
        return (
          <View key={a.id} style={styles.tile}>
            <Pressable
              onPress={() => onOpen(a)}
              accessibilityRole="button"
              accessibilityLabel={t('composer.previewAttachment').replace(
                '{name}',
                a.name,
              )}
              style={styles.tileHit}
            >
              {image ? (
                <NitroImage
                  image={{ filePath: a.localUri }}
                  style={styles.thumb}
                  resizeMode="cover"
                />
              ) : (
                <View
                  style={[
                    styles.fileFill,
                    { backgroundColor: theme.inputBackground },
                  ]}
                >
                  <Icon name="doc.text" size={22} color={theme.textSecondary} />
                  <Text
                    style={[styles.fileName, { color: theme.text }]}
                    numberOfLines={2}
                  >
                    {a.name}
                  </Text>
                </View>
              )}
              {a.uploadState === 'uploading' ? (
                <ActivityIndicator style={styles.progress} size="small" />
              ) : null}
            </Pressable>
            <Pressable
              style={styles.remove}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={t('composer.removeAttachment').replace(
                '{name}',
                a.name,
              )}
              onPress={() => onRemove(a.id)}
            >
              <View style={styles.removeBadge}>
                <Icon name="xmark" size={11} color="#FFFFFF" />
              </View>
            </Pressable>
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 0 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingBottom: 8,
  },
  tile: {
    width: ATTACHMENT_TILE,
    height: ATTACHMENT_TILE,
    borderRadius: 14,
    overflow: 'hidden',
  },
  tileHit: { width: ATTACHMENT_TILE, height: ATTACHMENT_TILE },
  thumb: { width: ATTACHMENT_TILE, height: ATTACHMENT_TILE, borderRadius: 12 },
  fileFill: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingHorizontal: 6,
  },
  fileName: { fontSize: 10, textAlign: 'center' },
  progress: {
    position: 'absolute',
    alignSelf: 'center',
    top: ATTACHMENT_TILE / 2 - 10,
  },
  remove: { position: 'absolute', top: 6, right: 6 },
  removeBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
