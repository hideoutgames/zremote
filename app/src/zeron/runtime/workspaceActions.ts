// Workspace mutations (WorkspaceStore.swift writes + the preferred
// Mutate-over-relay paths). Registry-backed actions are LWW field writes /
// full-row upserts on our replica; the host converges via the registry room.

import {
  buildArchivedSet,
  buildChatCheckoutSet,
  buildChatConfigSet,
  buildCreateChatSet,
  buildDeleteChatKeys,
  buildDeleteSpaceKeys,
  buildMarkSeenSet,
  buildRenameSet,
  projectWorkspace,
} from '../doc/workspaceProjection';
import { newId } from '../doc/sessionDoc';
import { METHODS } from '../protocol/rpc';
import type { ChatConfig } from '../protocol/types';
import type { FieldValue } from '../protocol/registryCore';
import type { AppRuntime } from './appRuntime';

const now = (): number => Date.now();

const write = (
  runtime: AppRuntime,
  kind: string,
  id: string,
  set: Record<string, FieldValue | null>,
): void => {
  runtime.registryDoc.write(kind, id, 'upsert', set);
  runtime.registry.flushPending();
};

// ── Chat lifecycle ─────────────────────────────────────────────────────

/** workspace_host.rs create_chat shape: full-row upsert; the space's owning
 * device hosts the chat. roomGen: 2 (born on chat2). */
export const createChat = (
  runtime: AppRuntime,
  args: {
    deviceId: string;
    spaceId?: string;
    cwd: string;
    config?: ChatConfig;
    branch?: string;
  },
): string => {
  const create = buildCreateChatSet({ ...args, nowMs: now() });
  write(runtime, create.kind, create.id, create.set);
  return create.chatId;
};

export const createProjectlessChat = (
  runtime: AppRuntime,
  deviceId: string,
  config?: ChatConfig,
  cwd = '',
): string => createChat(runtime, { deviceId, cwd, config });

export const renameChat = (
  runtime: AppRuntime,
  chatId: string,
  title: string,
): void => write(runtime, 'chats', chatId, buildRenameSet(title));

export const setChatArchived = (
  runtime: AppRuntime,
  chatId: string,
  archived: boolean,
): void => write(runtime, 'chats', chatId, buildArchivedSet(archived));

export const markChatSeen = (runtime: AppRuntime, chatId: string): void =>
  write(runtime, 'chats', chatId, buildMarkSeenSet(now()));

export const deleteChat = (runtime: AppRuntime, chatId: string): void => {
  runtime.registryDoc.deleteRows(buildDeleteChatKeys(chatId));
  runtime.registry.flushPending();
};

export const setChatConfig = (
  runtime: AppRuntime,
  chatId: string,
  config: ChatConfig,
): void => write(runtime, 'chats', chatId, buildChatConfigSet(config));

export const setChatCheckout = (
  runtime: AppRuntime,
  chatId: string,
  cwd: string,
  branch: string,
): void => write(runtime, 'chats', chatId, buildChatCheckoutSet(cwd, branch));

// ── Spaces ─────────────────────────────────────────────────────────────

/** Preferred path (WorkspaceStore.createSpace): Mutate over the device relay
 * so the HOST writes the row (git detection happens on the host). Falls back
 * to a local registry upsert when the host is unreachable, as the Swift
 * does — the host still owns the row's deviceId. */
export const createSpace = async (
  runtime: AppRuntime,
  args: {
    deviceId: string;
    path: string;
    name?: string;
    gitDetected?: boolean;
  },
): Promise<string> => {
  const spaceId = newId();
  const params = {
    op: 'createSpace',
    spaceId,
    deviceId: args.deviceId,
    path: args.path,
    ...(args.name !== undefined ? { name: args.name } : {}),
    gitDetected: args.gitDetected ?? false,
  };
  try {
    await runtime.relayFor(args.deviceId).call<unknown>(METHODS.MUTATE, params);
  } catch {
    // Host unreachable: write the row ourselves; the host reconciles.
    write(runtime, 'spaces', spaceId, {
      id: spaceId,
      deviceId: args.deviceId,
      path: args.path,
      ...(args.name !== undefined ? { name: args.name } : {}),
      gitDetected: args.gitDetected ?? false,
      createdAt: now(),
    });
  }
  return spaceId;
};

export const deleteSpace = (runtime: AppRuntime, spaceId: string): void => {
  runtime.registryDoc.deleteRows(
    buildDeleteSpaceKeys(projectWorkspace(runtime.registryDoc), spaceId),
  );
  runtime.registry.flushPending();
};
