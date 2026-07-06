import {useCallback, useRef} from 'react';
import BootSplash from 'react-native-bootsplash';


export function useHideBootSplashOnLayout(): () => void {
  const splashHiddenRef = useRef(false);

  return useCallback(() => {
    if (splashHiddenRef.current) {
      return;
    }
    splashHiddenRef.current = true;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        BootSplash.hide({fade: true});
      });
    });
  }, []);
}
