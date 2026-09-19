// Tool group rail — visual port of official iOS ToolGroupView / ToolChipRow
// (_ref/zeron/apps/ios/Zeron/Transcript/TranscriptView.swift). Chip labels
// still come from the zeron proto port in transcript/toolLabel.ts.

import React, { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { MessagePart } from '../../zeron/protocol/types';
import { Icon } from '../Icon';
import { useTheme } from '../../theme';
import { t } from '../../i18n/strings';
import {
  toolChipContent,
  toolGroupSummary,
  toolIcon,
} from '../transcript/toolLabel';

export type ToolPart = Extract<MessagePart, { kind: 'tool' }>;

const OUTPUT_PREVIEW = 160;

const byteLabel = (bytes: number): string =>
  bytes >= 1024 ? `${Math.round(bytes / 1024)} KB` : `${bytes} B`;

const summaryFields = (part: ToolPart): [string, string][] => {
  const fields: [string, string][] = [];
  const c = part.call as Record<string, unknown>;
  for (const [k, v] of Object.entries(c)) {
    if (k === 'kind') continue;
    if (
      typeof v === 'string' ||
      typeof v === 'number' ||
      typeof v === 'boolean'
    )
      fields.push([k, String(v)]);
  }
  return fields;
};

const ToolChipRow = ({
  part,
  continues,
  onFetchOutput,
}: {
  part: ToolPart;
  continues: boolean;
  onFetchOutput?: (partId: string) => void;
}) => {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(false);
  const { label, detail } = toolChipContent(part.call);
  const errored = part.isError === true;
  const expandable =
    part.output !== undefined ||
    part.outputRef !== undefined ||
    summaryFields(part).length > 0 ||
    detail !== '';

  const toggle = useCallback(
    () => expandable && setExpanded(e => !e),
    [expandable],
  );

  return (
    <View>
      <Pressable
        style={styles.chip}
        onPress={toggle}
        hitSlop={4}
        accessibilityRole="button"
        accessibilityLabel={`${label}${detail === '' ? '' : `, ${detail}`}`}
        accessibilityState={{ expanded, disabled: !expandable }}
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
        <View style={[styles.expanded, { borderColor: theme.border }]}>
          {summaryFields(part).map(([k, v]) => (
            <Text
              key={k}
              style={[styles.expandedLine, { color: theme.textSecondary }]}
              numberOfLines={2}
            >
              {`${k}: ${v}`}
            </Text>
          ))}
          {part.output !== undefined ? (
            <Text
              style={[styles.expandedLine, { color: theme.text }]}
              numberOfLines={6}
            >
              {part.output.length > OUTPUT_PREVIEW
                ? `${part.output.slice(0, OUTPUT_PREVIEW)}…`
                : part.output}
            </Text>
          ) : null}
          {part.outputRef !== undefined && part.outputBytes !== undefined ? (
            <Pressable onPress={() => onFetchOutput?.(part.id)} hitSlop={6}>
              <Text style={[styles.fetchLink, { color: theme.accent }]}>
                {`${t('session.fullOutput')} (${byteLabel(part.outputBytes)})`}
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
  onFetchOutput,
  autoOpen = false,
}: {
  parts: ToolPart[];
  onFetchOutput?: (partId: string) => void;
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
              onFetchOutput={onFetchOutput}
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
    gap: 3,
  },
  expandedLine: { fontSize: 12, fontFamily: 'Menlo' },
  fetchLink: { fontSize: 13, fontWeight: '500', marginTop: 2 },
});
