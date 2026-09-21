// Compose send: create the chat from persisted compose defaults, wait for
// the session to subscribe, then send the first run with the live draft.

import {
  DESKTOP_SANDBOX,
  type ChatConfig,
  type WorktreeSpec,
} from '../protocol/types';
import type { StagedAttachment } from '../state/draftStore';
import {
  COMPOSE_DRAFT_ID,
  clearDraft,
  draftFor,
  moveDraft,
  setDraftPendingWorktree,
} from '../state/draftStore';
import {
  rememberComposeDefaults,
  rememberModelPick,
  rememberModelSettings,
  type ComposeDefaults,
} from '../state/uiPrefs';
import { workspaceStore } from '../state/workspaceStore';
import { isPresenceFresh } from '../protocol/entities';
import type { AppRuntime } from './appRuntime';
import { createChat, createProjectlessChat } from './workspaceActions';

export type CreateThreadFromComposeOpts = {
  text: string;
  settings: ComposeDefaults;
  worktree?: WorktreeSpec;
  branch?: string;
  attachments?: readonly StagedAttachment[];
};

export const createThreadFromCompose = async (
  runtime: AppRuntime,
  opts: CreateThreadFromComposeOpts,
): Promise<string> => {
  const { settings, text } = opts;
  if (settings.deviceId === '' || settings.harness === '') {
    throw new Error('compose: host and agent are required');
  }
  const draft = draftFor(COMPOSE_DRAFT_ID);
  const worktree = opts.worktree ?? draft?.pendingWorktree;
  const attachments = opts.attachments ?? draft?.attachments ?? [];
  const spaces = workspaceStore.getState().spaces;
  const space =
    settings.spaceId === undefined
      ? undefined
      : spaces.find(s => s.id === settings.spaceId);
  const config: ChatConfig = {
    harness: settings.harness,
    model: settings.model === '' ? undefined : settings.model,
    reasoning: settings.reasoning,
    sandbox: DESKTOP_SANDBOX,
    modelOptions: settings.modelOptions ?? {},
  };
  const chatId =
    space !== undefined
      ? createChat(runtime, {
          deviceId: settings.deviceId,
          spaceId: space.id,
          cwd: space.path,
          config,
          ...(opts.branch !== undefined ? { branch: opts.branch } : {}),
        })
      : createProjectlessChat(runtime, settings.deviceId, config);
  rememberComposeDefaults(settings);
  if (settings.harness !== '' && settings.model !== '') {
    rememberModelPick({ harness: settings.harness, model: settings.model });
    rememberModelSettings(settings.harness, settings.model, {
      ...(settings.reasoning !== undefined
        ? { reasoning: settings.reasoning }
        : {}),
      ...(settings.modelOptions !== undefined
        ? { modelOptions: settings.modelOptions }
        : {}),
    });
  }
  const controller = runtime.openSession(chatId);
  await controller.start();
  const hostOnline = isPresenceFresh(
    workspaceStore.getState().presence[settings.deviceId],
    Date.now(),
  );
  if (attachments.length > 0) {
    const plan = await controller.sendWithAttachments(
      text,
      { config, cwd: space?.path },
      attachments,
      {
        worktree,
        phase: 'idle',
        draftChatId: COMPOSE_DRAFT_ID,
        forceQueue: !hostOnline,
      },
    );
    if (plan === 'blocked') throw new Error('compose: attachments blocked');
  } else if (!hostOnline) {
    controller.queueMessage(text);
  } else {
    controller.sendRun(
      text,
      { config, cwd: space?.path },
      { ...(worktree !== undefined ? { worktree } : {}) },
    );
  }
  moveDraft(COMPOSE_DRAFT_ID, chatId);
  if (worktree !== undefined) setDraftPendingWorktree(chatId, undefined);
  clearDraft(chatId);
  return chatId;
};
