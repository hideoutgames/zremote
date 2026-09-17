// Ported from Agents Kit (permissive collections only):
//   components/beautiful-ui/tool-chips.tsx  — MIT © Shane Levine
//   components/beui/... tool-result        — MIT © Saurabh Chauhan
// A compact rail for one or more consecutive `tool` message parts: one row per
// call (icon, label, detail), spinner while unresolved, red on error; expand
// shows summary fields + truncated output + "Show full output (N KB)".
// DOM/Tailwind replaced with StyleSheet + theme tokens; chip content and the
// group summary come from the zeron proto port in transcript/toolLabel.ts.

import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
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

const ToolRow = ({
  part,
  onFetchOutput,
}: {
  part: ToolPart;
  onFetchOutput?: (partId: string) => void;
}) => {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(false);
  const { label, detail } = toolChipContent(part.call);
  const errored = part.isError === true;
  const expandable =
    part.output !== undefined ||
    part.outputRef !== undefined ||
    summaryFields(part).length > 0;

  const toggle = useCallback(
    () => expandable && setExpanded(e => !e),
    [expandable],
  );

  return (
    <View>
      <Pressable style={styles.row} onPress={toggle} hitSlop={4}>
        <View
          style={[
            styles.iconTile,
            { backgroundColor: theme.surface, borderColor: theme.border },
          ]}
        >
          {part.resolved ? (
            <Icon
              name={toolIcon(part.call)}
              size={14}
              color={errored ? theme.danger : theme.textSecondary}
            />
          ) : (
            <ActivityIndicator size={12} color={theme.textSecondary} />
          )}
        </View>
        <View style={styles.rowText}>
          <Text
            style={[
              styles.label,
              { color: errored ? theme.danger : theme.text },
            ]}
            numberOfLines={1}
          >
            {label}
          </Text>
          {detail !== '' ? (
            <Text
              style={[styles.detail, { color: theme.textSecondary }]}
              numberOfLines={1}
            >
              {detail}
            </Text>
          ) : null}
        </View>
        {expandable ? (
          <Icon
            name="chevron.down"
            size={12}
            color={theme.textSecondary}
            style={expanded ? styles.chevronUp : undefined}
          />
        ) : null}
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
 * each call's row. */
export const ToolActivity = React.memo(function ({
  parts,
  onFetchOutput,
}: {
  parts: ToolPart[];
  onFetchOutput?: (partId: string) => void;
}) {
  const theme = useTheme();
  const [open, setOpen] = useState(parts.length === 1);
  const running = parts.some(p => !p.resolved);
  const anyError = parts.some(p => p.isError === true);

  if (parts.length === 1) {
    return (
      <View style={styles.group}>
        <ToolRow part={parts[0]} onFetchOutput={onFetchOutput} />
      </View>
    );
  }

  return (
    <View
      style={[
        styles.group,
        { backgroundColor: theme.cardBackground, borderColor: theme.border },
      ]}
    >
      <Pressable
        style={styles.groupHeader}
        onPress={() => setOpen(o => !o)}
        hitSlop={4}
      >
        {running ? (
          <ActivityIndicator size={12} color={theme.textSecondary} />
        ) : (
          <Icon
            name="checklist"
            size={13}
            color={anyError ? theme.danger : theme.textSecondary}
          />
        )}
        <Text
          style={[
            styles.groupLabel,
            { color: anyError ? theme.danger : theme.textSecondary },
          ]}
          numberOfLines={1}
        >
          {toolGroupSummary(parts)}
        </Text>
        <Icon
          name="chevron.down"
          size={12}
          color={theme.textSecondary}
          style={open ? styles.chevronUp : undefined}
        />
      </Pressable>
      {open
        ? parts.map(p => (
            <ToolRow key={p.id} part={p} onFetchOutput={onFetchOutput} />
          ))
        : null}
    </View>
  );
});

const styles = StyleSheet.create({
  group: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    marginVertical: 3,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  groupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 5,
  },
  groupLabel: { flex: 1, fontSize: 13, fontWeight: '500' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 4,
  },
  iconTile: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: { flex: 1, flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  label: { fontSize: 13, fontWeight: '600' },
  detail: { flex: 1, fontSize: 13 },
  expanded: {
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: 4,
    paddingTop: 6,
    paddingBottom: 4,
    gap: 3,
  },
  expandedLine: { fontSize: 12, fontFamily: 'Menlo' },
  fetchLink: { fontSize: 13, fontWeight: '500', marginTop: 2 },
  chevronUp: { transform: [{ rotate: '180deg' }] },
});
