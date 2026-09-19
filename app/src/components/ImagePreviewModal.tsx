// Native full-screen image preview for composer attachments. Presented as
// a full-screen Modal (UIViewController) — not GlassSheet.

import React from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NitroImage } from 'react-native-nitro-image';
import { Icon } from './Icon';
import { t } from '../i18n/strings';

export function ImagePreviewModal({
  uri,
  name,
  onDismiss,
}: {
  uri: string;
  name: string;
  onDismiss: () => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal
      visible
      animationType="fade"
      presentationStyle="fullScreen"
      onRequestClose={onDismiss}
    >
      <View
        style={styles.root}
        accessibilityLabel={name}
        accessibilityRole="image"
      >
        <Pressable
          onPress={onDismiss}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={t('common.done')}
          style={[styles.close, { top: insets.top + 8 }]}
        >
          <Icon name="xmark" size={18} color="#FFFFFF" />
        </Pressable>
        <NitroImage
          image={{ filePath: uri }}
          style={styles.image}
          resizeMode="contain"
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#000000',
    justifyContent: 'center',
  },
  close: {
    position: 'absolute',
    left: 16,
    zIndex: 2,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: { width: '100%', height: '100%' },
});
