// Queue + PR Liquid Glass pills that sit above the composer.

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { GlassControl } from './Glass';
import { BrandMark } from './BrandMark';
import { svgForPullRequest } from './harnessBrand';
import { useChromeTheme } from '../chromeTheme';
import { t } from '../i18n/strings';
import type { PrBadgeModel } from './prBadge';

/** Matches Composer container padding so the PR chip lines up with the glass. */
export const COMPOSER_EDGE_PAD = 12;

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
  const theme = useChromeTheme();
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
        <GlassControl
          interactive
          onPress={onOpenQueue}
          accessibilityRole="button"
          accessibilityLabel={`${queueCount} ${t('session.queuedLocally')}`}
          testID="queued-pill"
          style={styles.pill}
        >
          <View style={styles.pillHit}>
            <Text style={[styles.pillText, { color: theme.text }]}>
              {`${queueCount} ${t('session.queuedLocally')}`}
            </Text>
          </View>
        </GlassControl>
      ) : null}
      {pr !== undefined ? (
        <GlassControl
          interactive
          onPress={onOpenPr}
          accessibilityRole="button"
          accessibilityLabel={t(
            pr.label === 'viewPrDraft' ? 'pr.viewDraftA11y' : 'pr.viewA11y',
          )}
          testID="pr-pill"
          style={styles.pill}
        >
          <View style={styles.pillHit}>
            <BrandMark svg={svgForPullRequest(prColor)} size={16} />
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
          </View>
        </GlassControl>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: COMPOSER_EDGE_PAD,
    paddingBottom: 8,
  },
  pill: {
    borderRadius: 22,
    overflow: 'hidden',
    minHeight: 44,
    alignSelf: 'flex-start',
  },
  pillHit: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  pillText: { fontSize: 15, fontWeight: '600' },
  count: { fontSize: 14, fontWeight: '600' },
});
