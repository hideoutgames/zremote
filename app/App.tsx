import React, { useEffect } from 'react';
import {
  SafeAreaProvider,
  initialWindowMetrics,
} from 'react-native-safe-area-context';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import BootSplash from 'react-native-bootsplash';
import { installJsFatalGuard } from './src/zeron/native/jsFatalGuard';
import { ZeronApp } from './src/app/ZeronApp';

installJsFatalGuard();

export default function App() {
  // HideOnDraw used to live only on SessionScreen, so a cold start that
  // lands on SignIn / OrgGate / Home never dismissed the native splash.
  useEffect(() => {
    const id = setTimeout(() => {
      BootSplash.hide({ fade: true }).catch(() => {});
    }, 2500);
    return () => clearTimeout(id);
  }, []);
  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <BootSplash.HideOnDraw fade />
      <KeyboardProvider>
        <ZeronApp />
      </KeyboardProvider>
    </SafeAreaProvider>
  );
}
