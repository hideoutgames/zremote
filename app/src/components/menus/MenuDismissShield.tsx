import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { menuOpenCount, subscribeMenuGate } from './menuGate';

const useMenuOpen = (): boolean => {
  const [open, setOpen] = useState(() => menuOpenCount() > 0);
  useEffect(() => subscribeMenuGate(() => setOpen(menuOpenCount() > 0)), []);
  return open;
};

const absorbPress = (): void => {};

/** Absorbs the RN hit that would otherwise fire under a dismissing UIMenu. */
export function MenuDismissShield() {
  const open = useMenuOpen();
  if (!open) return null;
  return (
    <Pressable
      style={styles.shield}
      onPress={absorbPress}
      accessible={false}
      importantForAccessibility="no"
    />
  );
}

const styles = StyleSheet.create({
  shield: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 9999,
    elevation: 9999,
  },
});
