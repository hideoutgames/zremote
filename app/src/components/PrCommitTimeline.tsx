// Checkout git-history timeline used by the PR Discussion and Commits tabs.

import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import type { GitHistoryCommit } from '../zeron/protocol/types';
import { Icon } from './Icon';
import { useTheme } from '../theme';
import { t } from '../i18n/strings';
import {
  formatRelativeShort,
  groupByCommitDay,
  parseCommitTime,
} from './prTime';

const dayLabel = (key: string): string => {
  if (key === 'today') return t('pr.today');
  if (key === 'yesterday') return t('pr.yesterday');
  return key;
};

export function PrCommitTimeline({
  commits,
  loading,
  error,
  caption,
  onLoadMore,
}: {
  commits: readonly GitHistoryCommit[];
  loading: boolean;
  error?: string;
  caption?: string;
  onLoadMore?: () => void;
}) {
  const theme = useTheme();
  const now = Date.now();
  const groups = groupByCommitDay(commits, now);

  if (loading && commits.length === 0) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator />
      </View>
    );
  }
  if (error !== undefined && commits.length === 0) {
    return <Text style={[styles.empty, { color: theme.danger }]}>{error}</Text>;
  }
  if (commits.length === 0) {
    return (
      <Text style={[styles.empty, { color: theme.textSecondary }]}>
        {t('pr.emptyCommits')}
      </Text>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.list}>
      {caption !== undefined && caption !== '' ? (
        <Text style={[styles.caption, { color: theme.textSecondary }]}>
          {caption}
        </Text>
      ) : null}
      {groups.map(group => (
        <View key={group.key}>
          <View style={styles.dayRow}>
            <Text style={[styles.day, { color: theme.textSecondary }]}>
              {dayLabel(group.key)}
            </Text>
            <View style={[styles.dayLine, { backgroundColor: theme.border }]} />
          </View>
          {group.items.map((commit, index) => (
            <CommitRow
              key={commit.sha}
              commit={commit}
              last={index === group.items.length - 1}
              now={now}
            />
          ))}
        </View>
      ))}
      {onLoadMore !== undefined ? (
        <Pressable
          onPress={onLoadMore}
          accessibilityRole="button"
          accessibilityLabel={t('pr.loadMore')}
          testID="pr-load-more"
          style={styles.more}
        >
          <Text style={[styles.moreLabel, { color: theme.text }]}>
            {loading ? t('pr.loadingCommits') : t('pr.loadMore')}
          </Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

function CommitRow({
  commit,
  last,
  now,
}: {
  commit: GitHistoryCommit;
  last: boolean;
  now: number;
}) {
  const theme = useTheme();
  const when = formatRelativeShort(parseCommitTime(commit.authoredAt), now);
  const label = t('pr.committed').replace('{author}', commit.authorName);

  return (
    <View style={styles.row}>
      <View style={styles.rail}>
        <View style={[styles.mark, { backgroundColor: theme.surface }]}>
          <Icon name="arrow.triangle.branch" size={14} color={theme.text} />
        </View>
        {last ? null : (
          <View style={[styles.stem, { backgroundColor: theme.border }]} />
        )}
      </View>
      <Pressable
        onPress={() => {
          Clipboard.setStringAsync(commit.sha).catch(() => {});
        }}
        onLongPress={() => {
          Clipboard.setStringAsync(commit.sha).catch(() => {});
        }}
        accessibilityRole="button"
        accessibilityLabel={`${label}, ${commit.subject}, ${when}`}
        accessibilityHint={t('history.copySha')}
        style={styles.body}
      >
        <View style={styles.headline}>
          <Text
            style={[styles.author, { color: theme.text }]}
            numberOfLines={1}
          >
            {label}
          </Text>
          <Text style={[styles.sha, { color: theme.textSecondary }]}>
            {commit.sha.slice(0, 7)}
          </Text>
          <Text style={[styles.when, { color: theme.textSecondary }]}>
            {when}
          </Text>
        </View>
        <Text style={[styles.subject, { color: theme.text }]} numberOfLines={3}>
          {commit.subject}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  list: { paddingHorizontal: 16, paddingBottom: 24 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  empty: { padding: 24, textAlign: 'center', fontSize: 16 },
  dayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingTop: 16,
    paddingBottom: 8,
  },
  caption: { fontSize: 13, paddingTop: 8, paddingBottom: 4 },
  more: { minHeight: 44, justifyContent: 'center', paddingVertical: 12 },
  moreLabel: { fontSize: 15, fontWeight: '600' },
  day: { fontSize: 13 },
  dayLine: { flex: 1, height: StyleSheet.hairlineWidth },
  row: { flexDirection: 'row', minHeight: 64 },
  rail: { width: 36, alignItems: 'center' },
  mark: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stem: { width: 2, flex: 1, marginVertical: 4 },
  body: {
    flex: 1,
    paddingBottom: 16,
    paddingLeft: 10,
    gap: 4,
  },
  headline: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
  },
  author: { flex: 1, fontSize: 15, fontWeight: '600' },
  sha: { fontSize: 13, fontVariant: ['tabular-nums'] },
  when: { fontSize: 13 },
  subject: { fontSize: 15, lineHeight: 20 },
});
