// RN iOS leaves a stale RCTModalHostViewController (invisible hit target)
// if a Modal is unmounted while still visible. Hide first, then unmount
// after the native dismiss — onDismiss on iOS, after the hide commit on
// Android (no onDismiss).

import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';

export function useDismissibleNativeModal(onDismissed: () => void): {
  visible: boolean;
  hide: () => void;
  onRequestClose: () => void;
  onDismiss: () => void;
} {
  const [visible, setVisible] = useState(true);
  const onDismissedRef = useRef(onDismissed);
  onDismissedRef.current = onDismissed;
  const finished = useRef(false);

  const finish = useCallback(() => {
    if (finished.current) return;
    finished.current = true;
    onDismissedRef.current();
  }, []);

  const hide = useCallback(() => {
    setVisible(false);
  }, []);

  useEffect(() => {
    if (!visible && Platform.OS !== 'ios') finish();
  }, [finish, visible]);

  return {
    visible,
    hide,
    onRequestClose: hide,
    onDismiss: finish,
  };
}
