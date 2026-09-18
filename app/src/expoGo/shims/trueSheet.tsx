// Expo Go preview shim — not used in production builds.
// @lodev09/react-native-true-sheet → a pageSheet Modal. The app always mounts
// TrueSheet while it should be visible and dismisses via `onDidDismiss`
// (swipe) or unmount, so present()/dismiss() are no-ops here.

import React, { forwardRef, useImperativeHandle } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  View,
  type ColorValue,
} from 'react-native';

export interface TrueSheetProps {
  detents?: (number | 'auto')[];
  initialDetentIndex?: number;
  onDidDismiss?: () => void;
  grabber?: boolean;
  backgroundColor?: ColorValue;
  maxContentHeight?: number;
  dismissible?: boolean;
  children?: React.ReactNode;
  style?: object;
}

export interface TrueSheetRef {
  present(index?: number): Promise<void>;
  dismiss(): Promise<void>;
}

const detentHeight = (
  detents: TrueSheetProps['detents'],
  initialDetentIndex: number | undefined,
  maxContentHeight: number | undefined,
): string | number => {
  const detent = detents?.[initialDetentIndex ?? 0];
  if (typeof detent === 'number') return `${Math.round(detent * 100)}%`;
  if (maxContentHeight !== undefined) return maxContentHeight;
  return '85%';
};

export const TrueSheet = forwardRef<TrueSheetRef, TrueSheetProps>(
  (
    {
      onDidDismiss,
      grabber,
      backgroundColor,
      maxContentHeight,
      detents,
      initialDetentIndex,
      children,
    },
    ref,
  ) => {
    useImperativeHandle(ref, () => ({
      present: async () => {},
      dismiss: async () => onDidDismiss?.(),
    }));
    const height = detentHeight(detents, initialDetentIndex, maxContentHeight);
    const sized = typeof height === 'string';
    return (
      <Modal
        visible
        transparent
        animationType="slide"
        presentationStyle="overFullScreen"
        onRequestClose={() => onDidDismiss?.()}
      >
        <Pressable
          style={styles.backdrop}
          onPress={() => onDidDismiss?.()}
          accessibilityLabel="Dismiss"
        />
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: backgroundColor ?? '#1c1c1e',
              height: sized ? height : undefined,
              maxHeight: sized ? height : height,
            },
          ]}
        >
          {grabber ? <View style={styles.grabber} /> : null}
          {children}
        </View>
      </Modal>
    );
  },
);
TrueSheet.displayName = 'TrueSheet';

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    overflow: 'hidden',
    paddingBottom: 12,
  },
  grabber: {
    alignSelf: 'center',
    width: 36,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: 'rgba(255,255,255,0.3)',
    marginTop: 6,
    marginBottom: 4,
  },
});

export default TrueSheet;
