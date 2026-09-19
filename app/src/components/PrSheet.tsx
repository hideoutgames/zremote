// PR sheet filled from Zeron change-request, checkout diffs, and checkout
// git history. Share / open-in-browser use the URL the host already sent —
// the phone has no checks or merge RPCs.

import React, { useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { EnrichedMarkdownText } from 'react-native-enriched-markdown';
import * as Clipboard from 'expo-clipboard';
import * as DropdownMenu from './menus/dropdown-menu';
import { useStore } from 'zustand';
import { markdownStyleFor } from '../markdownStyle';
import { ChangesScreen } from '../screens/ChangesScreen';
import { changeRequestStore } from '../zeron/state/changeRequestStore';
import { useCheckoutGitHistory } from '../hooks/useCheckoutGitHistory';
import { Glass, GlassControl } from './Glass';
import { Icon } from './Icon';
import { PrCommitTimeline } from './PrCommitTimeline';
import {
  hasPrStats,
  isCheckoutPr,
  prStateLabelKey,
  type PrBadgeModel,
} from './prBadge';
import { prToneColor, prToneFill } from './prChrome';
import { openPrUrl, sharePrUrl } from './prUrl';
import { useDismissibleNativeModal } from '../hooks/useDismissibleNativeModal';
import { useTheme } from '../theme';
import { t } from '../i18n/strings';

type PrTab = 'overview' | 'discussion' | 'commits';

export function PrSheet({
  chatId,
  badge,
  onDismiss,
}: {
  chatId: string;
  badge: PrBadgeModel;
  onDismiss: () => void;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const {
    visible,
    hide,
    onRequestClose,
    onDismiss: onModalDismiss,
  } = useDismissibleNativeModal(onDismiss);
  const [tab, setTab] = useState<PrTab>('overview');
  const liveSummary = useStore(
    changeRequestStore,
    s => s.byChat[chatId]?.changeRequest ?? undefined,
  );
  const liveDiff = useStore(changeRequestStore, s => s.diffByChat[chatId]);
  const checkout = isCheckoutPr(badge, liveSummary);
  const model = useMemo((): PrBadgeModel => {
    if (!checkout || liveSummary === undefined) return badge;
    return {
      ...badge,
      title: liveSummary.title.replace(/[\r\n]+/g, ' '),
      body: liveSummary.body ?? liveSummary.description ?? badge.body,
      state: liveSummary.state,
      tone:
        liveSummary.state === 'merged'
          ? 'merged'
          : liveSummary.draft === true
          ? 'draft'
          : 'open',
      baseRef: liveSummary.baseRef,
      headRef: liveSummary.headRef,
      url: liveSummary.url !== '' ? liveSummary.url : badge.url,
      additions: liveDiff?.additions ?? badge.additions,
      deletions: liveDiff?.deletions ?? badge.deletions,
      fileCount:
        liveDiff !== undefined ? liveDiff.files.length : badge.fileCount,
    };
  }, [badge, checkout, liveDiff, liveSummary]);
  const history = useCheckoutGitHistory(chatId);
  const toneColor = prToneColor(theme, model);
  const hasUrl = model.url !== '';
  const refs =
    model.baseRef !== '' && model.headRef !== ''
      ? `${model.baseRef} ← ${model.headRef}`
      : '';

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      allowSwipeDismissal
      onRequestClose={onRequestClose}
      onDismiss={onModalDismiss}
    >
      <View
        testID="pr-sheet"
        style={[
          styles.fill,
          { backgroundColor: theme.background, paddingTop: insets.top },
        ]}
      >
        <View style={styles.header}>
          <GlassControl
            onPress={hide}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t('session.back')}
            style={styles.circle}
          >
            <Icon name="chevron.left" size={18} color={theme.text} />
          </GlassControl>
          <View style={styles.headerSpacer} />
          {hasUrl ? (
            <View style={styles.headerRight}>
              <GlassControl
                onPress={() => sharePrUrl(model.url)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={t('pr.shareA11y')}
                testID="pr-share"
                style={styles.circle}
              >
                <Icon name="link" size={16} color={theme.text} />
              </GlassControl>
              <Glass interactive style={styles.circle}>
                <DropdownMenu.Root>
                  <DropdownMenu.Trigger asChild>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={t('pr.moreA11y')}
                      testID="pr-more"
                      style={styles.controlFill}
                    >
                      <Icon name="ellipsis" size={16} color={theme.text} />
                    </Pressable>
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Content>
                    <DropdownMenu.Item
                      key="copy"
                      onSelect={() => {
                        Clipboard.setStringAsync(model.url).catch(() => {});
                      }}
                    >
                      <DropdownMenu.ItemTitle>
                        {t('pr.copyLink')}
                      </DropdownMenu.ItemTitle>
                    </DropdownMenu.Item>
                    <DropdownMenu.Item
                      key="open"
                      onSelect={() => openPrUrl(model.url)}
                    >
                      <DropdownMenu.ItemTitle>
                        {t('pr.openInBrowser')}
                      </DropdownMenu.ItemTitle>
                    </DropdownMenu.Item>
                  </DropdownMenu.Content>
                </DropdownMenu.Root>
              </Glass>
            </View>
          ) : (
            <View style={styles.circle} />
          )}
        </View>

        <View style={styles.meta}>
          <View style={styles.statsRow}>
            <View
              style={[
                styles.statePill,
                { backgroundColor: prToneFill(theme, model) },
              ]}
            >
              <Text style={[styles.stateText, { color: toneColor }]}>
                {t(prStateLabelKey(model))}
              </Text>
            </View>
            {hasPrStats(model) ? (
              <Text
                style={[styles.stats, { color: theme.textSecondary }]}
                accessibilityLabel={t('pr.statsA11y')
                  .replace('{additions}', String(model.additions))
                  .replace('{deletions}', String(model.deletions))
                  .replace('{files}', String(model.fileCount))}
              >
                <Text style={{ color: theme.diffAddText }}>
                  {`+${model.additions}`}
                </Text>
                {` `}
                <Text style={{ color: theme.diffDelText }}>
                  {`-${model.deletions}`}
                </Text>
                {` · ${t('pr.files').replace(
                  '{count}',
                  String(model.fileCount),
                )}`}
              </Text>
            ) : null}
          </View>
          <Text
            style={[styles.prTitle, { color: theme.text }]}
            accessibilityRole="header"
          >
            {model.title}
            <Text
              style={{ color: theme.textSecondary }}
            >{` #${model.number}`}</Text>
          </Text>
          <View style={styles.tabs} accessibilityRole="tablist">
            <PrTabButton
              id="overview"
              label={t('pr.overview')}
              selected={tab === 'overview'}
              onPress={() => setTab('overview')}
            />
            <PrTabButton
              id="discussion"
              label={t('pr.discussion')}
              selected={tab === 'discussion'}
              onPress={() => setTab('discussion')}
            />
            <PrTabButton
              id="commits"
              label={t('pr.commits')}
              count={history.commits.length}
              selected={tab === 'commits'}
              onPress={() => setTab('commits')}
            />
          </View>
        </View>

        {tab === 'overview' ? (
          <OverviewTab chatId={chatId} model={model} refs={refs} />
        ) : (
          <PrCommitTimeline
            commits={history.commits}
            loading={history.loading}
            error={history.error}
          />
        )}
      </View>
    </Modal>
  );
}

function OverviewTab({
  chatId,
  model,
  refs,
}: {
  chatId: string;
  model: PrBadgeModel;
  refs: string;
}) {
  const theme = useTheme();
  const body = model.body?.trim() ?? '';

  return (
    <View style={styles.fill}>
      <ScrollView contentContainerStyle={styles.overview}>
        {refs !== '' ? (
          <View
            style={[
              styles.card,
              {
                backgroundColor: theme.cardBackground,
                borderColor: theme.border,
              },
            ]}
          >
            <Text
              style={[styles.refs, { color: theme.text }]}
              numberOfLines={2}
            >
              {refs}
            </Text>
          </View>
        ) : null}
        {body !== '' ? (
          <EnrichedMarkdownText
            markdown={body}
            markdownStyle={markdownStyleFor(theme)}
            flavor="github"
          />
        ) : null}
        <Text style={[styles.changed, { color: theme.textSecondary }]}>
          {t('pr.whatChanged')}
        </Text>
      </ScrollView>
      <View style={styles.diffs}>
        <ChangesScreen chatId={chatId} embedded />
      </View>
    </View>
  );
}

function PrTabButton({
  id,
  label,
  count,
  selected,
  onPress,
}: {
  id: PrTab;
  label: string;
  count?: number;
  selected: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const title = count !== undefined && count > 0 ? `${label} ${count}` : label;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      accessibilityLabel={title}
      testID={`pr-tab-${id}`}
      style={[
        styles.tab,
        selected ? { backgroundColor: theme.surface } : undefined,
      ]}
    >
      <Text
        style={[
          styles.tabLabel,
          { color: selected ? theme.text : theme.textSecondary },
        ]}
        numberOfLines={1}
      >
        {title}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  headerSpacer: { flex: 1 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  controlFill: {
    flex: 1,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
  },
  circle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  meta: { paddingHorizontal: 16, paddingBottom: 8, gap: 10 },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flexWrap: 'wrap',
  },
  statePill: {
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  stateText: { fontSize: 13, fontWeight: '600' },
  stats: { fontSize: 15, fontWeight: '600' },
  prTitle: { fontSize: 26, fontWeight: '700', lineHeight: 32 },
  tabs: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  tab: {
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  tabLabel: { fontSize: 15, fontWeight: '500' },
  overview: { paddingHorizontal: 16, paddingBottom: 12, gap: 14 },
  card: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
    gap: 12,
  },
  refs: { fontSize: 15, fontWeight: '600' },
  changed: { fontSize: 20, fontWeight: '600', marginTop: 4 },
  diffs: { flex: 1, minHeight: 180 },
});
