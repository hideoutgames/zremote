// Paints canonical composer references as inline pills. The glyphs are the
// short label the TextInput also holds, so the caret stays aligned.
import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { composerSurface, type BadgeKind } from '../zeron/composer/badges';
import { useTheme } from '../theme';

const FILL: Record<BadgeKind, { dark: string; light: string }> = {
  command: {
    dark: 'rgba(10,132,255,0.28)',
    light: 'rgba(0,122,255,0.16)',
  },
  skill: {
    dark: 'rgba(191,90,242,0.30)',
    light: 'rgba(137,68,171,0.18)',
  },
  file: {
    dark: 'rgba(142,142,147,0.35)',
    light: 'rgba(108,108,112,0.18)',
  },
};

export function ComposerReferenceText({
  canonical,
  color,
}: {
  canonical: string;
  color: string;
}) {
  const theme = useTheme();
  const { runs } = composerSurface(canonical);
  const scheme = theme.scheme;
  return (
    <Text style={{ color }}>
      {runs.map((run, index) => {
        if (run.kind === undefined) return run.text;
        const fill = FILL[run.kind];
        const ink =
          run.kind === 'command'
            ? theme.accent
            : run.kind === 'skill'
            ? theme.prMerged
            : theme.text;
        return (
          <Text
            key={index}
            style={[
              styles.badge,
              {
                backgroundColor: scheme === 'dark' ? fill.dark : fill.light,
                color: ink,
              },
            ]}
          >
            {run.text}
          </Text>
        );
      })}
    </Text>
  );
}

const styles = StyleSheet.create({
  badge: {
    borderRadius: 5,
  },
});
