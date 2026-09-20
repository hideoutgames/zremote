// Tool group rail — visual port of official iOS ToolGroupView / ToolChipRow
// (_ref/zeron/apps/ios/Zeron/Transcript/TranscriptView.swift). Chip labels
// come from the zeron proto port in transcript/toolLabel.ts; expanded body
// from transcript.rs call_block / tool_detail / blob_detail.

import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import type { MessagePart } from '../../zeron/protocol/types';
import { Icon } from '../Icon';
import { FileDiff } from './FileDiff';
import { useTheme } from '../../theme';
import { t } from '../../i18n/strings';
import {
  toolChipContent,
  toolGroupSummary,
  toolIcon,
} from '../transcript/toolLabel';
import {
  blobDetail,
  blobPartId,
  callBlock,
  formatKb,
  toolCopyText,
  toolDetail,
  type ToolDetail,
} from '../transcript/toolDetail';

export type ToolPart = Extract<MessagePart, { kind: 'tool' }>;

export type FetchToolBlob = (partId: string) => Promise<string>;

type BlobKind = 'diff' | 'output';

const LINE_HEIGHT = 18;
const DIFF_MAX_HEIGHT = 24 * LINE_HEIGHT;

const OutputBlock = ({
  detail,
}: {
  detail: Extract<ToolDetail, { kind: 'output' }>;
}) => {
  const theme = useTheme();
  return (
    <View>
      {detail.lines.map((line, i) => (
        <Text
          key={i}
          style={[styles.expandedLine, { color: theme.text }]}
          selectable
        >
          {line === '' ? ' ' : line}
        </Text>
      ))}
      {detail.truncatedBy > 0 ? (
        <Text style={[styles.expandedLine, { color: theme.textSecondary }]}>
          {`${t('session.truncatedBy')} ${detail.truncatedBy}`}
        </Text>
      ) : null}
    </View>
  );
};

const StatsBlock = ({
  detail,
}: {
  detail: Extract<ToolDetail, { kind: 'stats' }>;
}) => {
  const theme = useTheme();
  return (
    <View>
      {detail.stats.map(s => (
        <View key={s.path} style={styles.statRow}>
          <Text
            style={[styles.statPath, { color: theme.textSecondary }]}
            numberOfLines={1}
          >
            {s.path}
          </Text>
          <Text style={[styles.statDelta, { color: theme.diffAddText }]}>
            {`+${s.additions}`}
          </Text>
          <Text style={[styles.statDelta, { color: theme.diffDelText }]}>
            {`−${s.deletions}`}
          </Text>
        </View>
      ))}
    </View>
  );
};

const DiffBlock = ({
  detail,
}: {
  detail: Extract<ToolDetail, { kind: 'diff' }>;
}) => {
  const theme = useTheme();
  return (
    <View>
      <View style={styles.diffClip}>
        <FileDiff file={detail.file} />
      </View>
      {detail.truncatedBy > 0 ? (
        <Text style={[styles.expandedLine, { color: theme.textSecondary }]}>
          {`${t('session.truncatedBy')} ${detail.truncatedBy}`}
        </Text>
      ) : null}
    </View>
  );
};

const DetailBody = ({ detail }: { detail: ToolDetail }) => {
  switch (detail.kind) {
    case 'output':
      return <OutputBlock detail={detail} />;
    case 'stats':
      return <StatsBlock detail={detail} />;
    case 'diff':
      return <DiffBlock detail={detail} />;
  }
};

const affordanceLabel = (
  kind: BlobKind,
  state: 'idle' | 'loading' | 'failed' | 'ready',
  bytes?: number,
): string => {
  if (kind === 'diff') {
    if (state === 'loading') return t('session.loadingFullDiff');
    if (state === 'failed') return t('session.retryFullDiff');
    return t('session.fullDiff');
  }
  if (state === 'loading') return t('session.loadingFullOutput');
  if (state === 'failed') return t('session.retryFullOutput');
  return bytes !== undefined
    ? `${t('session.fullOutput')} (${formatKb(bytes)})`
    : t('session.fullOutput');
};

const nextOffer = (
  shown: BlobKind | undefined,
  ready: Partial<Record<BlobKind, ToolDetail>>,
  diffId: string | undefined,
  outputId: string | undefined,
): BlobKind | undefined => {
  const offer = (kind: BlobKind, id: string | undefined) => {
    if (id === undefined) return undefined;
    if (shown === kind && ready[kind] !== undefined) return undefined;
    return kind;
  };
  return offer('diff', diffId) ?? offer('output', outputId);
};

const ToolChipRow = ({
  part,
  continues,
  onFetchBlob,
}: {
  part: ToolPart;
  continues: boolean;
  onFetchBlob?: FetchToolBlob;
}) => {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(false);
  const [ready, setReady] = useState<Partial<Record<BlobKind, ToolDetail>>>({});
  const [loading, setLoading] = useState<BlobKind | undefined>(undefined);
  const [failed, setFailed] = useState<Partial<Record<BlobKind, true>>>({});
  const [shown, setShown] = useState<BlobKind | undefined>(undefined);
  const { label, detail } = toolChipContent(part.call);
  const errored = part.isError === true;
  const invocation = useMemo(() => callBlock(part.call), [part.call]);
  const resident = useMemo(
    () => toolDetail(part.output, part.diff, part.diffStats),
    [part.output, part.diff, part.diffStats],
  );
  const result =
    shown !== undefined && ready[shown] !== undefined ? ready[shown] : resident;
  const outputId =
    part.outputRef !== undefined ? blobPartId(part.outputRef) : undefined;
  const diffId =
    part.diffRef !== undefined ? blobPartId(part.diffRef) : undefined;
  const expandable =
    invocation !== undefined ||
    resident !== undefined ||
    outputId !== undefined ||
    diffId !== undefined ||
    detail !== '';

  const toggle = useCallback(
    () => expandable && setExpanded(e => !e),
    [expandable],
  );

  const copyDetails = useCallback(() => {
    const text = toolCopyText(invocation, result);
    if (text === '') return;
    Clipboard.setStringAsync(text).catch(() => {});
  }, [invocation, result]);

  const offered = nextOffer(shown, ready, diffId, outputId);

  const onAffordance = useCallback(() => {
    if (offered === undefined || onFetchBlob === undefined) return;
    const kind = offered;
    if (ready[kind] !== undefined) {
      setShown(kind);
      return;
    }
    if (loading === kind) return;
    const id = kind === 'diff' ? diffId : outputId;
    if (id === undefined) return;
    setLoading(kind);
    setFailed(f => {
      const next = { ...f };
      delete next[kind];
      return next;
    });
    return onFetchBlob(id)
      .then(text => {
        const upgraded = blobDetail(text, kind === 'diff');
        if (upgraded === undefined) {
          setFailed(f => ({ ...f, [kind]: true }));
          return;
        }
        setReady(r => ({ ...r, [kind]: upgraded }));
        setShown(kind);
      })
      .catch(() => {
        setFailed(f => ({ ...f, [kind]: true }));
      })
      .finally(() => {
        setLoading(current => (current === kind ? undefined : current));
      });
  }, [offered, onFetchBlob, ready, loading, diffId, outputId]);

  const offeredState: 'idle' | 'loading' | 'failed' | 'ready' =
    offered === undefined
      ? 'idle'
      : loading === offered
      ? 'loading'
      : failed[offered] === true
      ? 'failed'
      : ready[offered] !== undefined
      ? 'ready'
      : 'idle';

  return (
    <View>
      <Pressable
        style={styles.chip}
        onPress={toggle}
        onLongPress={copyDetails}
        hitSlop={4}
        accessibilityRole="button"
        accessibilityLabel={`${label}${detail === '' ? '' : `, ${detail}`}`}
        accessibilityHint={t('session.copyDetails')}
        accessibilityState={{ expanded, disabled: !expandable }}
        testID="tool-chip"
      >
        <View style={styles.rail}>
          <View style={[styles.railTick, { backgroundColor: theme.border }]} />
          <Icon
            name={toolIcon(part.call)}
            size={14}
            color={errored ? theme.danger : theme.textSecondary}
          />
          <View
            style={[
              styles.railStem,
              continues ? { backgroundColor: theme.border } : styles.railOff,
            ]}
          />
        </View>
        <View style={styles.chipText}>
          <View style={styles.chipTitle}>
            <Text
              style={[
                styles.label,
                { color: errored ? theme.danger : theme.textSecondary },
              ]}
              numberOfLines={1}
            >
              {label}
            </Text>
            {errored ? (
              <Text style={[styles.state, { color: theme.danger }]}>
                {t('session.toolFailed')}
              </Text>
            ) : !part.resolved ? (
              <Text style={[styles.state, { color: theme.textSecondary }]}>
                {t('session.toolRunning')}
              </Text>
            ) : null}
          </View>
          {detail !== '' ? (
            <Text
              style={[styles.detail, { color: theme.text }]}
              numberOfLines={expanded ? undefined : 2}
            >
              {detail}
            </Text>
          ) : null}
        </View>
      </Pressable>
      {expanded ? (
        <View
          style={[styles.expanded, { borderColor: theme.border }]}
          testID="tool-chip-body"
        >
          {invocation !== undefined ? <DetailBody detail={invocation} /> : null}
          {result !== undefined ? <DetailBody detail={result} /> : null}
          {offered !== undefined && onFetchBlob !== undefined ? (
            <Pressable
              onPress={onAffordance}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel={affordanceLabel(
                offered,
                offeredState,
                offered === 'output' ? part.outputBytes : undefined,
              )}
              testID="tool-blob-link"
            >
              <Text style={[styles.fetchLink, { color: theme.accent }]}>
                {affordanceLabel(
                  offered,
                  offeredState,
                  offered === 'output' ? part.outputBytes : undefined,
                )}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
};

/** Consecutive tool parts collapse into one rail: a group summary header plus
 * each call's row. `autoOpen` matches official iOS trailing-group-while-streaming. */
export const ToolActivity = React.memo(function ({
  parts,
  onFetchBlob,
  autoOpen = false,
}: {
  parts: ToolPart[];
  onFetchBlob?: FetchToolBlob;
  autoOpen?: boolean;
}) {
  const theme = useTheme();
  const [userOpen, setUserOpen] = useState<boolean | undefined>(undefined);
  const open = userOpen ?? autoOpen;
  const anyError = parts.some(p => p.isError === true);

  return (
    <View style={styles.group} testID="tool-group">
      <Pressable
        style={styles.groupHeader}
        onPress={() => setUserOpen(!(userOpen ?? autoOpen))}
        hitSlop={4}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={toolGroupSummary(parts)}
        testID="tool-group-toggle"
      >
        <Icon
          name="chevron.right"
          size={11}
          color={theme.textSecondary}
          style={open ? styles.chevronOpen : undefined}
        />
        <Text
          style={[
            styles.groupLabel,
            { color: anyError ? theme.danger : theme.textSecondary },
          ]}
          numberOfLines={2}
        >
          {toolGroupSummary(parts)}
        </Text>
      </Pressable>
      {open
        ? parts.map((p, i) => (
            <ToolChipRow
              key={p.id}
              part={p}
              continues={i < parts.length - 1}
              onFetchBlob={onFetchBlob}
            />
          ))
        : null}
    </View>
  );
});

const styles = StyleSheet.create({
  group: {
    marginVertical: 3,
  },
  groupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 44,
  },
  groupLabel: { flex: 1, fontSize: 14 },
  chevronOpen: { transform: [{ rotate: '90deg' }] },
  chip: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    minHeight: 44,
  },
  rail: {
    width: 26,
    alignItems: 'center',
  },
  railTick: { width: 1, height: 5 },
  railStem: { width: 1, flex: 1, minHeight: 8 },
  railOff: { backgroundColor: 'transparent' },
  chipText: {
    flex: 1,
    paddingVertical: 10,
    gap: 4,
  },
  chipTitle: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
  },
  label: { fontSize: 14, fontWeight: '500' },
  state: { fontSize: 12 },
  detail: { fontSize: 13, fontFamily: 'Menlo' },
  expanded: {
    marginLeft: 36,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 6,
    paddingBottom: 4,
    gap: 6,
  },
  expandedLine: { fontSize: 12, fontFamily: 'Menlo', lineHeight: LINE_HEIGHT },
  fetchLink: { fontSize: 13, fontWeight: '500', marginTop: 2 },
  statRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: LINE_HEIGHT,
  },
  statPath: { flex: 1, fontSize: 12, fontFamily: 'Menlo' },
  statDelta: { fontSize: 12, fontFamily: 'Menlo' },
  diffClip: { maxHeight: DIFF_MAX_HEIGHT, overflow: 'hidden' },
});
