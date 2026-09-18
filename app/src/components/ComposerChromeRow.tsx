// Queue + PR Liquid Glass pills that sit above the composer.

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Glass } from './Glass';
import { BrandMark } from './BrandMark';
import { svgForPullRequest } from './harnessBrand';
import { useTheme } from '../theme';
import { t } from '../i18n/strings';
import type { PrBadgeModel } from './prBadge';

export function ComposerChromeRow({
  queueCount,
  onOpenQueue,
  pr,
  onOpenPr,
}: {
  queueCount: number;
  onOpenQueue: () => void;
  pr: PrBadgeModel | undefined;
  onOpenPr: () => void;
}) {
  const theme = useTheme();
  if (queueCount <= 0 && pr === undefined) return null;

  const prColor =
    pr === undefined
      ? theme.text
      : pr.tone === 'merged'
      ? theme.prMerged
      : theme.prOpen;

  return (
    <View style={styles.row}>
      {queueCount > 0 ? (
        <Pressable
          onPress={onOpenQueue}
          accessibilityRole="button"
          accessibilityLabel={`${queueCount} ${t('session.queuedLocally')}`}
        >
          <Glass style={styles.pill}>
            <Text style={[styles.pillText, { color: theme.text }]}>
              {`${queueCount} ${t('session.queuedLocally')}`}
            </Text>
          </Glass>
        </Pressable>
      ) : null}
      {pr !== undefined ? (
        <Pressable
          onPress={onOpenPr}
          accessibilityRole="button"
          accessibilityLabel={t(
            pr.label === 'viewPrDraft' ? 'pr.viewDraft' : 'pr.view',
          )}
        >
          <Glass style={styles.pill}>
            <BrandMark svg={svgForPullRequest(prColor)} size={14} />
            <Text style={[styles.pillText, { color: theme.text }]}>
              {pr.label === 'viewPrDraft' ? t('pr.viewDraft') : t('pr.view')}
            </Text>
            {pr.showCounts ? (
              <>
                <Text style={[styles.count, { color: theme.diffAddText }]}>
                  {`+${pr.additions}`}
                </Text>
                <Text style={[styles.count, { color: theme.diffDelText }]}>
                  {`-${pr.deletions}`}
                </Text>
              </>
            ) : null}
          </Glass>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: 7,
    overflow: 'hidden',
  },
  pillText: { fontSize: 14, fontWeight: '500' },
  count: { fontSize: 13, fontWeight: '600' },
});
