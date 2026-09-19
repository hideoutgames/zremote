// Compose send: create the chat from persisted compose defaults, move the
// `__compose__` draft onto the new id, then send the first run.

import {
  FULL_ACCESS_SANDBOX,
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
  type ComposeDefaults,
} from '../state/uiPrefs';
import { workspaceStore } from '../state/workspaceStore';
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
    sandbox: FULL_ACCESS_SANDBOX,
    modelOptions: {},
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
  moveDraft(COMPOSE_DRAFT_ID, chatId);
  rememberComposeDefaults(settings);
  if (settings.harness !== '' && settings.model !== '')
    rememberModelPick({ harness: settings.harness, model: settings.model });
  const controller = runtime.openSession(chatId);
  if (attachments.length > 0) {
    await controller.sendWithAttachments(
      text,
      { config, cwd: space?.path },
      attachments,
      { worktree, phase: 'idle' },
    );
  } else {
    controller.sendRun(
      text,
      { config, cwd: space?.path },
      { ...(worktree !== undefined ? { worktree } : {}) },
    );
  }
  if (worktree !== undefined) setDraftPendingWorktree(chatId, undefined);
  clearDraft(chatId);
  return chatId;
};
