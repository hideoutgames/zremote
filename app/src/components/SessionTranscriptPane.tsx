// Transcript subscription, split out of ActiveSessionScreen. Streaming
// updates the entries array many times a second; keeping that subscription
// here means the composer and the rest of the session chrome do not
// re-render on every token.

import React, { useCallback, useEffect } from 'react';
import type { View } from 'react-native';
import { useStore } from 'zustand';
import {
  getSessionStore,
  useSessionCommands,
} from '../zeron/state/sessionStores';
import {
  bindPendingWorkedDuration,
  workedDurationStore,
  type FrozenWorkedDuration,
} from '../zeron/state/workedDuration';
import { formatWorkedDurationRange } from '../zeron/state/workingElapsed';
import type { MessageEntry } from '../zeron/protocol/types';
import type { SessionController } from '../zeron/runtime/sessionController';
import { UserMessage } from './transcript/UserMessage';
import { AssistantMessage } from './transcript/AssistantMessage';
import {
  SessionTranscriptList,
  type SessionTranscriptListHandle,
} from './SessionTranscriptList';
import type { FetchToolBlob } from './agentsKit/ToolActivity';
import type { FileDiffRequest } from './FileDiffSheet';

const noopComposerHeight = () => {};

const workedForCaption = (
  item: MessageEntry,
  hide: boolean,
  byId: Record<string, FrozenWorkedDuration>,
): string | undefined => {
  if (hide) return undefined;
  if (item.status !== 'complete' && item.status !== 'aborted') return undefined;
  const frozen = byId[item.id];
  return frozen === undefined
    ? undefined
    : formatWorkedDurationRange(frozen.startedAt, frozen.endedAt);
};

export const SessionTranscriptPane = React.memo(function SessionTranscriptPane({
  chatId,
  openKey,
  transcriptRef,
  composerRef,
  contentMaxWidth,
  windowWidth,
  windowHeight,
  insetsTop,
  insetsBottom,
  onShowScrollDown,
  agentWorking,
  workingStartedAt,
  enterIdsRef,
  onUserMessageEntered,
  controller,
  onOpenReasoning,
  onFetchBlob,
  onOpenPlan,
  onOpenFileDiff,
}: {
  chatId: string;
  openKey: string;
  transcriptRef: React.RefObject<SessionTranscriptListHandle | null>;
  composerRef: React.RefObject<View | null>;
  contentMaxWidth?: number;
  windowWidth: number;
  windowHeight: number;
  insetsTop: number;
  insetsBottom: number;
  onShowScrollDown: (show: boolean) => void;
  agentWorking: boolean;
  workingStartedAt: number;
  enterIdsRef: React.MutableRefObject<Set<string>>;
  onUserMessageEntered: (id: string) => void;
  controller: SessionController | undefined;
  onOpenReasoning: (text: string) => void;
  onFetchBlob: FetchToolBlob;
  onOpenPlan: (name: string, markdown: string) => void;
  onOpenFileDiff: (file: FileDiffRequest) => void;
}) {
  const entries = useStore(getSessionStore(chatId), s => s.entries);
  const commands = useSessionCommands(chatId);
  const workedByMessage = useStore(workedDurationStore, s => s.byMessageId);
  const lastEntryId = entries[entries.length - 1]?.id;

  useEffect(() => {
    bindPendingWorkedDuration(chatId);
  }, [chatId, entries]);

  const renderEntry = useCallback(
    ({ item }: { item: MessageEntry }) =>
      item.role === 'user' ? (
        <UserMessage
          entry={item}
          chatId={chatId}
          animateEnter={enterIdsRef.current.has(item.id)}
          onEntered={onUserMessageEntered}
          loadAttachment={
            controller === undefined
              ? undefined
              : path => controller.readAttachment(path)
          }
        />
      ) : (
        <AssistantMessage
          entry={item}
          onOpenReasoning={onOpenReasoning}
          onFetchBlob={onFetchBlob}
          onOpenPlan={onOpenPlan}
          onOpenFileDiff={onOpenFileDiff}
          commands={commands}
          showWorking={agentWorking && item.id === lastEntryId}
          workingChatId={chatId}
          workingStartedAt={workingStartedAt}
          workedFor={workedForCaption(
            item,
            agentWorking && item.id === lastEntryId,
            workedByMessage,
          )}
        />
      ),
    [
      chatId,
      enterIdsRef,
      onUserMessageEntered,
      controller,
      onOpenReasoning,
      onFetchBlob,
      onOpenPlan,
      onOpenFileDiff,
      commands,
      agentWorking,
      lastEntryId,
      workingStartedAt,
      workedByMessage,
    ],
  );

  return (
    <SessionTranscriptList
      key={openKey}
      ref={transcriptRef}
      openKey={openKey}
      entries={entries}
      renderEntry={renderEntry}
      composerRef={composerRef}
      contentMaxWidth={contentMaxWidth}
      windowWidth={windowWidth}
      windowHeight={windowHeight}
      insetsTop={insetsTop}
      insetsBottom={insetsBottom}
      onComposerHeight={noopComposerHeight}
      onShowScrollDown={onShowScrollDown}
      working={agentWorking}
      chatId={chatId}
      startedAt={workingStartedAt}
    />
  );
});
