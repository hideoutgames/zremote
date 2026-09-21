// Render-error fence so a JS throw (worklet copy, unexpected null) becomes
// a retry screen instead of RCTFatal / SIGABRT in Release/TestFlight.

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { createLog } from '../zeron/log';
import { useTheme } from '../theme';
import { t } from '../i18n/strings';

const log = createLog();

type Props = { children: React.ReactNode; resetKey?: string };
type State = { errorName: string | null; resetKey?: string };

export class AppErrorBoundary extends React.Component<Props, State> {
  state: State = { errorName: null, resetKey: undefined };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { errorName: error.name || 'Error' };
  }

  static getDerivedStateFromProps(
    props: Props,
    state: State,
  ): Partial<State> | null {
    if (props.resetKey !== state.resetKey) {
      return { errorName: null, resetKey: props.resetKey };
    }
    return null;
  }

  componentDidCatch(error: Error): void {
    log.error(`render aborted (${error.name})`);
  }

  render(): React.ReactNode {
    if (this.state.errorName === null) return this.props.children;
    return <ErrorFallback onRetry={() => this.setState({ errorName: null })} />;
  }
}

function ErrorFallback({ onRetry }: { onRetry: () => void }) {
  const theme = useTheme();
  return (
    <View
      style={[styles.root, { backgroundColor: theme.background }]}
      testID="app-error-fallback"
    >
      <Text style={[styles.title, { color: theme.text }]}>
        {t('error.boundary.title')}
      </Text>
      <Text style={[styles.body, { color: theme.textSecondary }]}>
        {t('error.boundary.body')}
      </Text>
      <Pressable
        onPress={onRetry}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={t('error.boundary.retry')}
      >
        <Text style={[styles.retry, { color: theme.accent }]}>
          {t('error.boundary.retry')}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 10,
  },
  title: { fontSize: 20, fontWeight: '700' },
  body: { fontSize: 15, textAlign: 'center', lineHeight: 20 },
  retry: { fontSize: 17, fontWeight: '600', marginTop: 8 },
});
