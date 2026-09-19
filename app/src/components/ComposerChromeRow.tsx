// Queue + PR Liquid Glass pills that sit above the composer.

import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { Glass, GlassContainer } from './Glass';
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
    <GlassContainer spacing={8} style={styles.row}>
      {queueCount > 0 ? (
        <Glass interactive style={styles.pill}>
          <Pressable
            onPress={onOpenQueue}
            accessibilityRole="button"
            accessibilityLabel={`${queueCount} ${t('session.queuedLocally')}`}
            testID="queued-pill"
            style={styles.pillHit}
          >
            <Text style={[styles.pillText, { color: theme.text }]}>
              {`${queueCount} ${t('session.queuedLocally')}`}
            </Text>
          </Pressable>
        </Glass>
      ) : null}
      {pr !== undefined ? (
        <Glass interactive style={styles.pill}>
          <Pressable
            onPress={onOpenPr}
            accessibilityRole="button"
            accessibilityLabel={t(
              pr.label === 'viewPrDraft' ? 'pr.viewDraftA11y' : 'pr.viewA11y',
            )}
            style={styles.pillHit}
          >
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
          </Pressable>
        </Glass>
      ) : null}
    </GlassContainer>
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
    borderRadius: 18,
    overflow: 'hidden',
  },
  pillHit: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  pillText: { fontSize: 14, fontWeight: '500' },
  count: { fontSize: 13, fontWeight: '600' },
});
