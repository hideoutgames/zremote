// Assistant transcript row: parts in doc order — text → EnrichedMarkdownText
// (streamingAnimation while the entry streams and the part is the last text),
// reasoning → collapsible label opening ReasoningSheet, consecutive tool
// parts → one ToolActivity rail, todo calls → TaskRows, input → InputCard,
// error → red inline, image → placeholder card (bytes arrive via
// ReadAttachmentChunk in a later stage).

import React, { useMemo } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import type { MessageEntry, MessagePart } from '../../zeron/protocol/types';
import { EnrichedMarkdownText } from 'react-native-enriched-markdown';
import { markdownStyleFor } from '../../markdownStyle';
import { useTheme } from '../../theme';
import { Icon } from '../Icon';
import { ShimmerText } from '../ShimmerText';
import { ToolActivity, type ToolPart } from '../agentsKit/ToolActivity';
import { TaskRows } from '../agentsKit/TaskRows';
import { InputCard } from './InputCard';
import { t } from '../../i18n/strings';
import type { SFSymbol } from 'sf-symbols-typescript';

/** Render item: a single part, or a run of consecutive tool parts. */
type Item =
  | { kind: 'part'; part: MessagePart }
  | { kind: 'tools'; parts: ToolPart[] };

const groupParts = (parts: MessagePart[]): Item[] => {
  const items: Item[] = [];
  let run: ToolPart[] = [];
  const flush = () => {
    // `todo` calls render as a TaskRows list instead of inside the rail.
    const todos = run.filter(p => p.call.kind === 'todo');
    const rest = run.filter(p => p.call.kind !== 'todo');
    for (const p of todos) items.push({ kind: 'part', part: p });
    if (rest.length > 0) items.push({ kind: 'tools', parts: rest });
    run = [];
  };
  for (const part of parts) {
    if (part.kind === 'tool') run.push(part);
    else {
      flush();
      items.push({ kind: 'part', part });
    }
  }
  flush();
  return items;
};

const phaseLabel = (phase: string): string => {
  const key = `session.${phase}` as const;
  switch (phase) {
    case 'working':
    case 'queuedLocally':
    case 'synchronized':
    case 'stale':
    case 'errored':
    case 'awaitingInput':
      return t(key as Parameters<typeof t>[0]);
    default:
      return t('session.working');
  }
};

const reasoningTitle = (text: string): string => {
  const firstLine = text.trimStart().split('\n', 1)[0].trim();
  const bold = /^(?:#+\s*)?\*\*(.+?)\*\*$/.exec(firstLine);
  if (bold) return bold[1].trim();
  const heading = /^#+\s+(.+)$/.exec(firstLine);
  if (heading) return heading[1].trim();
  return t('session.reasoning');
};

const PartView = ({
  part,
  streaming,
  isLastText,
  onOpenReasoning,
  onFetchOutput,
}: {
  part: MessagePart;
  streaming: boolean;
  isLastText: boolean;
  onOpenReasoning: (text: string) => void;
  onFetchOutput?: (partId: string) => void;
}) => {
  const theme = useTheme();
  const mdStyle = markdownStyleFor(theme);
  switch (part.kind) {
    case 'text':
      return (
        <EnrichedMarkdownText
          markdown={part.text}
          markdownStyle={mdStyle}
          flavor="github"
          streamingAnimation={streaming && isLastText}
          onLinkPress={({ url }) => Linking.openURL(url)}
        />
      );
    case 'reasoning':
      return (
        <Pressable
          style={styles.traceRow}
          hitSlop={6}
          onPress={() => onOpenReasoning(part.text)}
        >
          <Icon name="clock" size={15} color={theme.textSecondary} />
          <Text
            style={[styles.traceLabel, { color: theme.textSecondary }]}
            numberOfLines={1}
          >
            {reasoningTitle(part.text)}
          </Text>
          <Icon name="chevron.right" size={13} color={theme.textSecondary} />
        </Pressable>
      );
    case 'input':
      return <InputCard part={part} />;
    case 'error':
      return (
        <Text style={[styles.error, { color: theme.danger }]}>
          {part.message}
        </Text>
      );
    case 'image':
      return (
        <View
          style={[
            styles.imageCard,
            {
              backgroundColor: theme.cardBackground,
              borderColor: theme.border,
            },
          ]}
        >
          <Icon name="photo" size={16} color={theme.textSecondary} />
          <Text
            style={[styles.imageName, { color: theme.text }]}
            numberOfLines={1}
          >
            {part.name}
          </Text>
        </View>
      );
    case 'tool':
      if (part.call.kind === 'todo')
        return (
          <TaskRows
            items={
              // RenderToolCall's loose `{kind:string}` member defeats case
              // narrowing — read `items` explicitly.
              (part.call as { items?: { text: string; done: boolean }[] })
                .items ?? []
            }
          />
        );
      return <ToolActivity parts={[part]} onFetchOutput={onFetchOutput} />;
    default:
      return null;
  }
};

export const AssistantMessage = React.memo(function ({
  entry,
  phase,
  onOpenReasoning,
  onFetchOutput,
}: {
  entry: MessageEntry;
  phase: string;
  onOpenReasoning: (text: string) => void;
  onFetchOutput?: (partId: string) => void;
}) {
  const theme = useTheme();
  const streaming = entry.status === 'streaming';
  const items = useMemo(() => groupParts(entry.parts), [entry.parts]);
  const lastTextId = [...entry.parts]
    .reverse()
    .find(p => p.kind === 'text')?.id;
  const waiting =
    streaming && !entry.parts.some(p => p.kind === 'text' && p.text !== '');

  return (
    <View style={styles.row}>
      {waiting ? (
        <View style={styles.statusRow}>
          <Icon
            name={
              (phase === 'working' ? 'sparkles' : 'text.bubble') as SFSymbol
            }
            size={15}
            color={theme.textSecondary}
          />
          <ShimmerText
            text={phaseLabel(phase)}
            width={140}
            fontSize={16}
            maxLines={1}
            align="left"
          />
        </View>
      ) : (
        items.map((item, i) =>
          item.kind === 'tools' ? (
            <ToolActivity
              key={`tools-${i}`}
              parts={item.parts}
              onFetchOutput={onFetchOutput}
            />
          ) : (
            <PartView
              key={item.part.id}
              part={item.part}
              streaming={streaming}
              isLastText={item.part.id === lastTextId}
              onOpenReasoning={onOpenReasoning}
              onFetchOutput={onFetchOutput}
            />
          ),
        )
      )}
      {entry.status === 'aborted' ? (
        <Text style={[styles.error, { color: theme.danger }]}>
          {t('session.interrupted')}
        </Text>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  row: { paddingHorizontal: 16, paddingVertical: 4 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  traceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
  },
  traceLabel: { flex: 1, fontSize: 16 },
  error: { fontSize: 13, marginTop: 4 },
  imageCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginVertical: 3,
  },
  imageName: { fontSize: 13 },
});
