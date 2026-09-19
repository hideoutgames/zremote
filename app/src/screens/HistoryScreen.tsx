// Thread History — pull requests in this session. The checkout's current
// change request (WatchCheckoutChangeRequest) plus github.com/.../pull/N
// URLs scraped from transcript text. Tapping a row opens PrSheet.

import React, { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useStore } from 'zustand';
import { useSessionState } from '../zeron/state/sessionStores';
import { changeRequestStore } from '../zeron/state/changeRequestStore';
import { collectThreadPrs } from '../components/threadPrs';
import type { PrBadgeModel } from '../components/prBadge';
import { Icon } from '../components/Icon';
import { useTheme } from '../theme';
import { t } from '../i18n/strings';

const stateLabel = (badge: PrBadgeModel): string => {
  if (badge.state === 'closed') return t('pr.closed');
  if (badge.tone === 'merged') return t('pr.merged');
  if (badge.tone === 'draft') return t('pr.draft');
  return t('pr.open');
};

const toneColor = (
  badge: PrBadgeModel,
  theme: ReturnType<typeof useTheme>,
): string => {
  if (badge.state === 'closed') return theme.textSecondary;
  if (badge.tone === 'merged') return theme.prMerged;
  if (badge.tone === 'draft') return theme.prDraft;
  return theme.prOpen;
};

export function HistoryScreen({
  chatId,
  onOpenPr,
}: {
  chatId: string;
  onOpenPr?: (badge: PrBadgeModel) => void;
}) {
  const theme = useTheme();
  const entries = useSessionState(chatId).entries;
  const summary = useStore(
    changeRequestStore,
    s => s.byChat[chatId]?.changeRequest ?? undefined,
  );
  const diff = useStore(changeRequestStore, s => s.diffByChat[chatId]);
  const prs = useMemo(
    () => collectThreadPrs(entries, summary, diff),
    [entries, summary, diff],
  );

  return (
    <View style={styles.root}>
      {prs.length === 0 ? (
        <Text style={[styles.empty, { color: theme.textSecondary }]}>
          {t('history.empty')}
        </Text>
      ) : (
        <ScrollView>
          {prs.map(badge => {
            const label = t('history.prRow')
              .replace('{number}', String(badge.number))
              .replace('{title}', badge.title);
            return (
              <Pressable
                key={badge.url !== '' ? badge.url : String(badge.number)}
                onPress={() => onOpenPr?.(badge)}
                accessibilityRole="button"
                accessibilityLabel={`${label}, ${stateLabel(badge)}`}
                style={[styles.row, { borderBottomColor: theme.border }]}
              >
                <View
                  style={[
                    styles.dot,
                    { backgroundColor: toneColor(badge, theme) },
                  ]}
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
  dot: { width: 8, height: 8, borderRadius: 4 },
  title: { flex: 1, fontSize: 16, fontWeight: '600' },
  number: { fontSize: 13, fontVariant: ['tabular-nums'] },
});
