// Assistant transcript row: every AI artifact for the turn lives inside one
// bubble — text, reasoning, tools, todos, questions, plan, file changes, the
// live working strip, and a Worked-for caption after the turn settles.

import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import * as ContextMenu from '../menus/context-menu';
import type {
  MessageEntry,
  MessagePart,
  SessionCommandEntry,
  UserInputAnswer,
} from '../../zeron/protocol/types';
import { useTheme } from '../../theme';
import { Icon } from '../Icon';
import {
  ToolActivity,
  type FetchToolBlob,
  type ToolPart,
} from '../agentsKit/ToolActivity';
import { TaskRows } from '../agentsKit/TaskRows';
import { InputCard } from './InputCard';
import { t } from '../../i18n/strings';
import {
  consumedPlanTextIds,
  detectPlanArtifact,
  isHiddenPlanToolPart,
  isPlanCardPart,
  planCardAnchorId,
  stripPlanMarkers,
  type PlanArtifact,
} from './detectPlan';
import { isSubagentSpawn, subagentView } from './detectSubagent';
import { isCompleteAssistant, turnChanges } from './turnChanges';
import type { TurnChange } from './turnChanges';
import { PlanCard } from './PlanCard';
import { SubAgentCard } from './SubAgentCard';
import { TurnChangesCard } from './TurnChangesCard';
import { messageCopyContent } from './MessageCopyMenu';
import { mendMarkdown } from './mendMarkdown';
import { FrostedBubble } from './FrostedBubble';
import { MarkdownWithCopy } from './MarkdownWithCopy';
import { WorkingStatusRow } from '../WorkingStatus';
import { inputAnswers } from './inputAnswers';

const NO_COMMANDS: SessionCommandEntry[] = [];

/** Render item: a single part, or a run of consecutive tool parts. */
type Item =
  | { kind: 'part'; part: MessagePart }
  | { kind: 'tools'; parts: ToolPart[] };

const groupParts = (parts: MessagePart[]): Item[] => {
  const items: Item[] = [];
  let run: ToolPart[] = [];
  const flush = () => {
    // Todos, subagent spawns, and plan cards render as their own blocks, in
    // doc order. Remaining consecutive tools stay in one ToolActivity rail.
    let tools: ToolPart[] = [];
    const flushTools = () => {
      if (tools.length > 0) items.push({ kind: 'tools', parts: tools });
      tools = [];
    };
    for (const p of run) {
      if (p.call.kind === 'todo' || isSubagentSpawn(p) || isPlanCardPart(p)) {
        flushTools();
        items.push({ kind: 'part', part: p });
      } else {
        tools.push(p);
      }
    }
    flushTools();
    run = [];
  };
  for (const part of parts) {
    if (part.kind === 'tool' && isHiddenPlanToolPart(part)) continue;
    if (part.kind === 'tool') run.push(part);
    else {
      flush();
      items.push({ kind: 'part', part });
    }
  }
  flush();
  return items;
};

const reasoningTitle = (text: string): string => {
  const firstLine = text.trimStart().split('\n', 1)[0].trim();
  const bold = /^(?:#+\s*)?\*\*(.+?)\*\*$/.exec(firstLine);
  if (bold) return bold[1].trim();
  const heading = /^#+\s+(.+)$/.exec(firstLine);
  if (heading) return heading[1].trim();
  return t('session.reasoning');
};

const PlanCardOpen = ({
  plan,
  onOpenPlan,
}: {
  plan: PlanArtifact;
  onOpenPlan?: (name: string, markdown: string) => void;
}) => (
  <PlanCard plan={plan} onOpen={() => onOpenPlan?.(plan.name, plan.markdown)} />
);

const PartView = ({
  part,
  streaming,
  isLastText,
  onOpenReasoning,
  onFetchBlob,
  answers,
  plan,
  planAnchorId,
  consumedIds,
  onOpenPlan,
}: {
  part: MessagePart;
  streaming: boolean;
  isLastText: boolean;
  onOpenReasoning: (text: string) => void;
  onFetchBlob?: FetchToolBlob;
  answers: readonly UserInputAnswer[];
  plan: PlanArtifact | undefined;
  planAnchorId: string | undefined;
  consumedIds: ReadonlySet<string>;
  onOpenPlan?: (name: string, markdown: string) => void;
}) => {
  const theme = useTheme();
  const card =
    part.id === planAnchorId && plan !== undefined ? (
      <PlanCardOpen plan={plan} onOpenPlan={onOpenPlan} />
    ) : null;
  switch (part.kind) {
    case 'text': {
      if (consumedIds.has(part.id)) return card;
      const visible = stripPlanMarkers(part.text);
      if (visible === '') return card;
      const source = streaming && isLastText ? mendMarkdown(visible) : visible;
      return (
        <>
          <MarkdownWithCopy
            markdown={source}
            streaming={streaming && isLastText}
          />
          {card}
        </>
      );
    }
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
      return <InputCard part={part} answers={answers} embedded />;
    case 'error':
      return (
        <Text style={[styles.error, { color: theme.danger }]}>
          {part.message}
        </Text>
      );
    case 'image':
      return (
        <View style={styles.imageCard}>
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
      if (isPlanCardPart(part)) return card;
      if (part.call.kind === 'todo')
        return (
          <TaskRows
            embedded
            items={
              // RenderToolCall's loose `{kind:string}` member defeats case
              // narrowing — read `items` explicitly.
              (part.call as { items?: { text: string; done: boolean }[] })
                .items ?? []
            }
          />
        );
      if (isSubagentSpawn(part))
        return <SubAgentCard view={subagentView(part)} />;
      return <ToolActivity parts={[part]} onFetchBlob={onFetchBlob} />;
    default:
      return null;
  }
};

export const AssistantMessage = React.memo(function ({
  entry,
  onOpenReasoning,
  onFetchBlob,
  onOpenPlan,
  onOpenFileDiff,
  commands = NO_COMMANDS,
  showWorking = false,
  workingChatId = '',
  workingStartedAt = 0,
  workedFor,
}: {
  entry: MessageEntry;
  onOpenReasoning: (text: string) => void;
  onFetchBlob?: FetchToolBlob;
  onOpenPlan?: (name: string, markdown: string) => void;
  onOpenFileDiff?: (file: TurnChange) => void;
  commands?: readonly SessionCommandEntry[];
  showWorking?: boolean;
  workingChatId?: string;
  workingStartedAt?: number;
  workedFor?: string;
}) {
  const theme = useTheme();
  const streaming = entry.status === 'streaming';
  const items = useMemo(() => groupParts(entry.parts), [entry.parts]);
  const plan = useMemo(() => detectPlanArtifact(entry), [entry]);
  const planAnchor = useMemo(() => planCardAnchorId(entry), [entry]);
  const consumedIds = useMemo(() => consumedPlanTextIds(entry), [entry]);
  const files = useMemo(
    () => (isCompleteAssistant(entry) ? turnChanges(entry) : []),
    [entry],
  );
  const lastTextId = [...entry.parts]
    .reverse()
    .find(p => p.kind === 'text')?.id;

  const fullText = entry.parts
    .filter(p => p.kind === 'text')
    .map(p => (p as { text: string }).text)
    .join('\n');
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger>
        <View style={styles.row}>
          <FrostedBubble
            testID="assistant-bubble"
            style={styles.bubble}
            contentStyle={styles.bubblePad}
            tintColor={theme.assistantBubbleBackground}
          >
            {items.map((item, i) =>
              item.kind === 'tools' ? (
                <ToolActivity
                  key={`tools-${i}`}
                  parts={item.parts}
                  onFetchBlob={onFetchBlob}
                  autoOpen={streaming && i === items.length - 1}
                />
              ) : (
                <PartView
                  key={item.part.id}
                  part={item.part}
                  streaming={streaming}
                  isLastText={item.part.id === lastTextId}
                  onOpenReasoning={onOpenReasoning}
                  onFetchBlob={onFetchBlob}
                  answers={
                    item.part.kind === 'input'
                      ? inputAnswers(commands, item.part.requestId)
                      : []
                  }
                  plan={plan}
                  planAnchorId={planAnchor}
                  consumedIds={consumedIds}
                  onOpenPlan={onOpenPlan}
                />
              ),
            )}
            {entry.status === 'aborted' ? (
              <Text style={[styles.error, { color: theme.danger }]}>
                {t('session.interrupted')}
              </Text>
            ) : null}
            {files.length > 0 && onOpenFileDiff !== undefined ? (
              <TurnChangesCard files={files} onOpenFile={onOpenFileDiff} />
            ) : null}
            {showWorking ? (
              <WorkingStatusRow
                compact
                chatId={workingChatId}
                startedAt={workingStartedAt}
              />
            ) : workedFor !== undefined ? (
              <Text
                testID="worked-for"
                style={[styles.workedFor, { color: theme.textSecondary }]}
              >
                {t('session.workedFor').replace('{time}', workedFor)}
              </Text>
            ) : null}
          </FrostedBubble>
        </View>
      </ContextMenu.Trigger>
      {messageCopyContent(fullText)}
    </ContextMenu.Root>
  );
});

const styles = StyleSheet.create({
  row: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 8,
    alignItems: 'flex-start',
  },
  bubble: {
    alignSelf: 'flex-start',
    maxWidth: '100%',
    borderRadius: 20,
  },
  bubblePad: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 8,
  },
  traceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
  },
  traceLabel: { flex: 1, fontSize: 16 },
  error: { fontSize: 13, marginTop: 4 },
  workedFor: { fontSize: 13, fontVariant: ['tabular-nums'] },
  imageCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
  },
  imageName: { fontSize: 13 },
});
