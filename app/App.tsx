import React from 'react';
import {
  SafeAreaProvider,
  initialWindowMetrics,
} from 'react-native-safe-area-context';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { maybeCompleteAuthSession } from './src/zeron/native/authBrowser';
import { ZeronApp } from './src/app/ZeronApp';

maybeCompleteAuthSession();

export default function App() {
  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <KeyboardProvider>
        <ZeronApp />
      </KeyboardProvider>
    </SafeAreaProvider>
  );
}
