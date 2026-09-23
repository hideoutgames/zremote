// Thread History — change requests for this session: the host's
// WatchCheckoutChangeRequest plus transcript-detected PR/MR links.
// Tapping a row opens PrSheet.

import React, { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useStore } from 'zustand';
import { changeRequestStore } from '../zeron/state/changeRequestStore';
import { collectThreadPrs } from '../components/threadPrs';
import { prStateLabelKey, type PrBadgeModel } from '../components/prBadge';
import { prToneColor } from '../components/prChrome';
import { BrandMark } from '../components/BrandMark';
import { svgForPullRequest } from '../components/harnessBrand';
import { Icon } from '../components/Icon';
import { useTheme } from '../theme';
import { t } from '../i18n/strings';

export function HistoryScreen({
  chatId,
  onOpenPr,
}: {
  chatId: string;
  onOpenPr?: (badge: PrBadgeModel) => void;
}) {
  const theme = useTheme();
  const summary = useStore(
    changeRequestStore,
    s => s.byChat[chatId]?.changeRequest ?? undefined,
  );
  const detected = useStore(changeRequestStore, s => s.detectedByChat[chatId]);
  const diff = useStore(changeRequestStore, s => s.diffByChat[chatId]);
  const prs = useMemo(
    () => collectThreadPrs(summary, diff, detected),
    [summary, diff, detected],
  );

  return (
    <View style={styles.root}>
      {prs.length === 0 ? (
        <Text style={[styles.empty, { color: theme.textSecondary }]}>
          {t('history.empty')}
        </Text>
      ) : (
        <ScrollView
          style={styles.list}
          contentContainerStyle={styles.listContent}
        >
          {prs.map(badge => {
            const label = t('history.prRow')
              .replace('{number}', String(badge.number))
              .replace('{title}', badge.title);
            return (
              <Pressable
                key={badge.url !== '' ? badge.url : String(badge.number)}
                onPress={() => onOpenPr?.(badge)}
                accessibilityRole="button"
                accessibilityLabel={`${label}, ${t(prStateLabelKey(badge))}`}
                style={[styles.row, { borderBottomColor: theme.border }]}
              >
                <BrandMark
                  svg={svgForPullRequest(prToneColor(theme, badge))}
                  size={16}
                />
                <Text
                  style={[styles.title, { color: theme.text }]}
                  numberOfLines={2}
                  maxFontSizeMultiplier={1.6}
                >
                  {badge.title}
                </Text>
                <Text
                  style={[styles.number, { color: theme.textSecondary }]}
                  numberOfLines={1}
                >
                  {`#${badge.number}`}
                </Text>
                <Icon
                  name="chevron.right"
                  size={14}
                  color={theme.textSecondary}
                />
              </Pressable>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  list: { flex: 1 },
  listContent: { paddingBottom: 16 },
  empty: { padding: 24, textAlign: 'center', fontSize: 16 },
  row: {
    minHeight: 44,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  title: { flex: 1, fontSize: 16, fontWeight: '600' },
  number: { fontSize: 13, fontVariant: ['tabular-nums'] },
});
