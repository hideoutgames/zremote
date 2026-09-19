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
  type DimensionValue,
} from 'react-native';
import { useDismissibleNativeModal } from '../../hooks/useDismissibleNativeModal';

export interface TrueSheetProps {
  detents?: (number | 'auto')[];
  initialDetentIndex?: number;
  onDidDismiss?: () => void;
  grabber?: boolean;
  backgroundColor?: ColorValue;
  maxContentHeight?: number;
  onDetentChange?: (event: { nativeEvent: { index: number } }) => void;
  dismissible?: boolean;
  children?: React.ReactNode;
  style?: object;
}

export interface TrueSheetRef {
  present(index?: number): Promise<void>;
  dismiss(): Promise<void>;
}

export const TrueSheet = forwardRef<TrueSheetRef, TrueSheetProps>(
  (
    {
      onDidDismiss,
      grabber,
      backgroundColor,
      maxContentHeight,
      detents,
      initialDetentIndex,
      dismissible,
      children,
    },
    ref,
  ) => {
    const canDismiss = dismissible !== false;
    const { visible, hide, onDismiss } = useDismissibleNativeModal(() => {
      onDidDismiss?.();
    });
    const dismiss = () => {
      if (canDismiss) hide();
    };
    useImperativeHandle(ref, () => ({
      present: async () => {},
      dismiss: async () => {
        hide();
      },
    }));
    const detent = detents?.[initialDetentIndex ?? 0];
    const fraction: DimensionValue | undefined =
      typeof detent === 'number' ? `${Math.round(detent * 100)}%` : undefined;
    const maxHeight: DimensionValue = fraction ?? maxContentHeight ?? '85%';
    const fill = fraction !== undefined;
    return (
      <Modal
        visible={visible}
        transparent
        animationType="slide"
        presentationStyle="overFullScreen"
        onRequestClose={dismiss}
        onDismiss={onDismiss}
      >
        <Pressable
          style={styles.backdrop}
          onPress={canDismiss ? dismiss : undefined}
          accessibilityLabel="Dismiss"
        />
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: backgroundColor ?? '#1c1c1e',
              height: fraction,
              maxHeight,
            },
            fill ? styles.fill : undefined,
          ]}
        >
          {grabber ? <View style={styles.grabber} /> : null}
          <View style={fill ? styles.fill : undefined}>{children}</View>
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
  fill: { flex: 1, minHeight: 0 },
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
