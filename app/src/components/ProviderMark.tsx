// Tiny provider glyph for composer / picker rows. Distinctive color + mark
// instead of shipping trademarked PNG logos.

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { ProviderKind } from './modelLabel';

const MARK: Record<ProviderKind, { bg: string; fg: string; glyph: string }> = {
  claude: { bg: '#D97757', fg: '#FFFFFF', glyph: '✶' },
  openai: { bg: '#10A37F', fg: '#FFFFFF', glyph: '◉' },
  cursor: { bg: '#555555', fg: '#FFFFFF', glyph: '▸' },
  devin: { bg: '#5B5CFF', fg: '#FFFFFF', glyph: 'D' },
  grok: { bg: '#1A1A1A', fg: '#FFFFFF', glyph: 'X' },
  zhipu: { bg: '#3859FF', fg: '#FFFFFF', glyph: 'Z' },
  google: { bg: '#4285F4', fg: '#FFFFFF', glyph: 'G' },
  generic: { bg: '#8E8E93', fg: '#FFFFFF', glyph: '◆' },
};

export function ProviderMark({
  kind,
  size = 16,
}: {
  kind: ProviderKind;
  size?: number;
}) {
  const mark = MARK[kind];
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no"
      style={[
        styles.wrap,
        {
          width: size,
          height: size,
          borderRadius: size * 0.28,
          backgroundColor: mark.bg,
        },
      ]}
    >
      <Text
        style={{
          color: mark.fg,
          fontSize: size * 0.62,
          fontWeight: '800',
          lineHeight: size * 0.72,
        }}
      >
        {mark.glyph}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center' },
});
