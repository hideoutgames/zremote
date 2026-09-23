// Assistant transcript row. While the turn streams, each grouped part is its
// own agent message bubble; once the turn settles, the work before the final
// message collapses into a single expandable bubble. The final message keeps
// the plan card, the interrupted note, file changes, the live working strip,
// and the Worked-for caption.

import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import * as ContextMenu from '../menus/context-menu';

// zeego's iOS Root forwards `style`/`__unsafeIosProps` to the native
// ContextMenuView at runtime but doesn't declare them in its types.
const ContextMenuRoot = ContextMenu.Root as React.ComponentType<
  React.ComponentProps<typeof ContextMenu.Root> & {
    __unsafeIosProps?: { style?: React.ComponentProps<typeof View>['style'] };
  }
>;
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
  stripPlanMarkers,
  type PlanArtifact,
} from './detectPlan';
import { isSubagentSpawn, subagentView } from './detectSubagent';
import { toolGroupSummary } from './toolLabel';
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
import { useSuppressAfterLongPress } from '../../hooks/useSuppressAfterLongPress';

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

/** A grouped item with something to show. Plan-card tools and text parts
 *  consumed as the plan body render nothing — the plan card is hoisted out
 *  of the part flow and attached to the end of the turn. */
const itemVisible = (item: Item, consumedIds: ReadonlySet<string>): boolean => {
  if (item.kind === 'tools') return true;
  const part = item.part;
  if (part.kind === 'tool') return !isPlanCardPart(part);
  if (part.kind === 'text')
    return !consumedIds.has(part.id) && stripPlanMarkers(part.text) !== '';
  return true;
};

/** Collapsed-work header: tool calls summarized like the tool rail, other
 *  messages counted as steps — "Ran 2 commands · 1 step". */
const workSummary = (items: Item[]): string => {
  const tools: ToolPart[] = [];
  let steps = 0;
  for (const item of items) {
    if (item.kind === 'tools') tools.push(...item.parts);
    else if (item.part.kind === 'tool') tools.push(item.part);
    else steps += 1;
  }
  const segments: string[] = [];
  if (tools.length > 0) segments.push(toolGroupSummary(tools));
  if (steps > 0)
    segments.push(
      steps === 1
        ? t('session.workStep')
        : t('session.workSteps').replace('{count}', String(steps)),
    );
  if (segments.length === 0) segments.push(t('session.work'));
  return segments.join(' · ');
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
  consumedIds,
}: {
  part: MessagePart;
  streaming: boolean;
  isLastText: boolean;
  onOpenReasoning: (text: string) => void;
  onFetchBlob?: FetchToolBlob;
  answers: readonly UserInputAnswer[];
  consumedIds: ReadonlySet<string>;
}) => {
  const theme = useTheme();
  const lp = useSuppressAfterLongPress();
  switch (part.kind) {
    case 'text': {
      if (consumedIds.has(part.id)) return null;
      const visible = stripPlanMarkers(part.text);
      if (visible === '') return null;
      const source = streaming && isLastText ? mendMarkdown(visible) : visible;
      return (
        <MarkdownWithCopy
          markdown={source}
          streaming={streaming && isLastText}
        />
      );
    }
    case 'reasoning':
      return (
        <Pressable
          testID="reasoning-row"
          style={styles.traceRow}
          hitSlop={6}
          onPress={() => {
            if (lp.isSuppressed()) return;
            onOpenReasoning(part.text);
          }}
          onPressIn={lp.onPressIn}
          onLongPress={lp.onLongPress}
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
      if (isPlanCardPart(part)) return null;
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
  const consumedIds = useMemo(() => consumedPlanTextIds(entry), [entry]);
  const files = useMemo(
    () => (isCompleteAssistant(entry) ? turnChanges(entry) : []),
    [entry],
  );
  const lastTextId = [...entry.parts]
    .reverse()
    .find(p => p.kind === 'text')?.id;
  const visibleItems = useMemo(
    () => items.filter(item => itemVisible(item, consumedIds)),
    [items, consumedIds],
  );
  // Rows recycle across entries — key the open state by entry id so a newly
  // settled turn always starts collapsed.
  const [workOpenId, setWorkOpenId] = useState<string | undefined>(undefined);
  const workOpen = workOpenId === entry.id;
  const lp = useSuppressAfterLongPress();

  const renderItem = (item: Item, key: string, isLast: boolean) =>
    item.kind === 'tools' ? (
      <ToolActivity
        key={key}
        parts={item.parts}
        onFetchBlob={onFetchBlob}
        autoOpen={streaming && isLast}
      />
    ) : (
      <PartView
        key={key}
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
        consumedIds={consumedIds}
      />
    );

  const itemKey = (item: Item, index: number): string =>
    item.kind === 'tools'
      ? `tools-${item.parts[0]?.id ?? index}`
      : `part-${item.part.id}`;

  const itemBubble = (item: Item, index: number, isLast: boolean) => (
    <FrostedBubble
      key={itemKey(item, index)}
      testID="assistant-bubble"
      style={styles.bubble}
      contentStyle={styles.bubblePad}
      tintColor={theme.assistantBubbleBackground}
    >
      {renderItem(item, `item-${index}`, isLast)}
    </FrostedBubble>
  );

  // Turn-level artifacts after the message content: the interrupted note,
  // file changes, the live working strip, or the Worked-for caption.
  const tail = (
    <>
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
    </>
  );

  let body: React.ReactNode;
  if (streaming) {
    // Working: every part is its own agent message.
    body = (
      <>
        {visibleItems.map((item, i) =>
          itemBubble(item, i, i === visibleItems.length - 1),
        )}
        {plan !== undefined ? (
          <PlanCardOpen plan={plan} onOpenPlan={onOpenPlan} />
        ) : null}
        {showWorking ? (
          <FrostedBubble
            testID="assistant-bubble"
            style={styles.bubble}
            contentStyle={styles.bubblePad}
            tintColor={theme.assistantBubbleBackground}
          >
            <WorkingStatusRow
              compact
              chatId={workingChatId}
              startedAt={workingStartedAt}
            />
          </FrostedBubble>
        ) : null}
      </>
    );
  } else {
    const workItems = visibleItems.slice(0, -1);
    const finalItem = visibleItems[visibleItems.length - 1];
    const finalBubble = (
      <FrostedBubble
        key="final"
        testID="assistant-bubble"
        style={styles.bubble}
        contentStyle={styles.bubblePad}
        tintColor={theme.assistantBubbleBackground}
      >
        {finalItem !== undefined ? renderItem(finalItem, 'final', false) : null}
        {plan !== undefined ? (
          <PlanCardOpen plan={plan} onOpenPlan={onOpenPlan} />
        ) : null}
        {tail}
      </FrostedBubble>
    );
    body =
      workItems.length === 0 ? (
        finalBubble
      ) : (
        <>
          <FrostedBubble
            testID="assistant-work-bubble"
            style={styles.bubble}
            contentStyle={styles.bubblePad}
            tintColor={theme.assistantBubbleBackground}
          >
            <Pressable
              testID="work-toggle"
              style={styles.workHeader}
              onPress={() => {
                if (lp.isSuppressed()) return;
                setWorkOpenId(workOpen ? undefined : entry.id);
              }}
              onPressIn={lp.onPressIn}
              onLongPress={lp.onLongPress}
              hitSlop={4}
              accessibilityRole="button"
              accessibilityState={{ expanded: workOpen }}
              accessibilityLabel={workSummary(workItems)}
            >
              <Icon
                name="chevron.right"
                size={11}
                color={theme.textSecondary}
                style={workOpen ? styles.chevronOpen : undefined}
              />
              <Text
                style={[styles.workLabel, { color: theme.textSecondary }]}
                numberOfLines={2}
              >
                {workSummary(workItems)}
              </Text>
            </Pressable>
            {workOpen
              ? workItems.map((item, i) => renderItem(item, `work-${i}`, false))
              : null}
          </FrostedBubble>
          {finalBubble}
        </>
      );
  }

  const fullText = entry.parts
    .filter(p => p.kind === 'text')
    .map(p => (p as { text: string }).text)
    .join('\n');
  return (
    <View testID="assistant-message" style={styles.row}>
      <ContextMenuRoot __unsafeIosProps={{ style: styles.triggerFill }}>
        <ContextMenu.Trigger style={styles.triggerFill}>
          <View style={styles.stack}>{body}</View>
        </ContextMenu.Trigger>
        {messageCopyContent(fullText, entry.createdAt)}
      </ContextMenuRoot>
    </View>
  );
});

const styles = StyleSheet.create({
  // Percentage maxWidth on the bubble must resolve against the list row,
  // not a shrink-wrapped ContextMenu trigger. Native markdown reports no
  // intrinsic size; a 0-width parent blanks the prose.
  row: {
    alignSelf: 'stretch',
    width: '100%',
    alignItems: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 8,
  },
  // The trigger view shrink-wraps its child unless told to fill the row —
  // without this the native markdown view measures at a narrow intrinsic
  // width and the whole bubble collapses to ~100pt columns.
  triggerFill: {
    alignSelf: 'stretch',
    width: '100%',
  },
  stack: {
    alignSelf: 'stretch',
    width: '100%',
    gap: 8,
  },
  workHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 36,
  },
  workLabel: { flex: 1, fontSize: 14 },
  chevronOpen: { transform: [{ rotate: '90deg' }] },
  bubble: {
    alignSelf: 'stretch',
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
