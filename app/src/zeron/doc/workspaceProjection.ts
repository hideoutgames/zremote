// Ported from zeron@853872d apps/ios/Zeron/Sync/WorkspaceStore.swift
// (project() L314–379, derived views L385–421, createChat/set-shapes
// L640–775). Rows → typed entities; set maps are `update` ops — they never
// create or revive rows ("never invent rows").

import {
  chatIndicator,
  chatUnseen,
  deviceSupports,
  effectiveStatus,
  sortActive,
  type ChatIndicator,
} from '../protocol/entities';
import type {
  Chat,
  ChatConfig,
  ConversationSourceContext,
  DeviceRow,
  SessionRow,
  SessionStatus,
  Space,
} from '../protocol/types';
import type { FieldValue } from '../protocol/registryCore';
import type { RegistryDoc } from './registryDoc';
import { newId } from './sessionDoc';

const SESSION_STATUSES = new Set<SessionStatus>([
  'idle',
  'working',
  'awaitingInput',
  'errored',
]);

const fstr = (
  row: { fields: Record<string, FieldValue> },
  key: string,
): string | undefined => {
  const v = row.fields[key];
  return typeof v === 'string' ? v : undefined;
};
const fnum = (
  row: { fields: Record<string, FieldValue> },
  key: string,
): number | undefined => {
  const v = row.fields[key];
  return typeof v === 'number' ? v : undefined;
};
const fbool = (
  row: { fields: Record<string, FieldValue> },
  key: string,
): boolean | undefined => {
  const v = row.fields[key];
  return typeof v === 'boolean' ? v : undefined;
};
const fobj = (
  row: { fields: Record<string, FieldValue> },
  key: string,
): Record<string, FieldValue> | undefined => {
  const v = row.fields[key];
  return typeof v === 'object' && v !== null && !Array.isArray(v)
    ? (v as Record<string, FieldValue>)
    : undefined;
};

/** ChatConfig → field value; nil optionals omitted like Swift's encoder. */
export const chatConfigToFields = (
  config: ChatConfig,
): Record<string, FieldValue> => ({
  harness: config.harness,
  ...(config.model !== undefined ? { model: config.model } : {}),
  ...(config.reasoning !== undefined ? { reasoning: config.reasoning } : {}),
  modelOptions: (config.modelOptions ?? {}) as Record<string, FieldValue>,
  ...(config.sandbox !== undefined ? { sandbox: config.sandbox } : {}),
});

/** Registry `sourceContext` value → typed snapshot. Unknown/missing fields
 * drop the whole context like upstream serde: a partial stamp is never
 * trusted for PR watches. */
const sourceContextFromFields = (
  o: Record<string, FieldValue>,
): ConversationSourceContext | undefined => {
  const str = (key: string): string | undefined => {
    const v = o[key];
    return typeof v === 'string' ? v : undefined;
  };
  const checkoutId = str('checkoutId');
  const repoRoot = str('repoRoot');
  const cwd = str('cwd');
  const branch = str('branch');
  const observedAt = str('observedAt');
  if (
    checkoutId === undefined ||
    repoRoot === undefined ||
    cwd === undefined ||
    branch === undefined ||
    observedAt === undefined
  ) {
    return undefined;
  }
  const headSha = str('headSha');
  return {
    checkoutId,
    repoRoot,
    cwd,
    branch,
    ...(headSha !== undefined ? { headSha } : {}),
    observedAt,
  };
};

const chatConfigFromFields = (o: Record<string, FieldValue>): ChatConfig => ({
  harness: typeof o.harness === 'string' ? o.harness : 'claude-code',
  ...(typeof o.model === 'string' ? { model: o.model } : {}),
  ...(typeof o.reasoning === 'string' ? { reasoning: o.reasoning } : {}),
  modelOptions: (typeof o.modelOptions === 'object' &&
  o.modelOptions !== null &&
  !Array.isArray(o.modelOptions)
    ? o.modelOptions
    : {}) as Record<string, unknown>,
  ...(typeof o.sandbox === 'string' ? { sandbox: o.sandbox } : {}),
});

export interface WorkspaceProjection {
  devices: DeviceRow[];
  spaces: Space[];
  chats: Chat[];
  sessions: Record<string, SessionRow>;
}

export const projectWorkspace = (doc: RegistryDoc): WorkspaceProjection => {
  const devices = doc
    .overlayRows('devices')
    .map(row => {
      const id = fstr(row, 'id') ?? row.id;
      const capabilities = row.fields.capabilities;
      return {
        id,
        name: fstr(row, 'name') ?? id,
        platform: fstr(row, 'platform') ?? '',
        ...(fnum(row, 'lastSeenAt') !== undefined
          ? { lastSeenAt: fnum(row, 'lastSeenAt') }
          : {}),
        ...(fnum(row, 'createdAt') !== undefined
          ? { createdAt: fnum(row, 'createdAt') }
          : {}),
        ...(fstr(row, 'version') !== undefined
          ? { version: fstr(row, 'version') }
          : {}),
        capabilities: Array.isArray(capabilities)
          ? capabilities.map(String)
          : [],
      } satisfies DeviceRow;
    })
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  const spaces = doc
    .overlayRows('spaces')
    .flatMap(row => {
      const deviceId = fstr(row, 'deviceId');
      const path = fstr(row, 'path');
      if (deviceId === undefined || path === undefined) return [];
      const space: Space = {
        id: fstr(row, 'id') ?? row.id,
        deviceId,
        path,
        ...(fstr(row, 'name') !== undefined ? { name: fstr(row, 'name') } : {}),
        gitDetected: fbool(row, 'gitDetected') ?? false,
        ...(fnum(row, 'gitCheckedAt') !== undefined
          ? { gitCheckedAt: fnum(row, 'gitCheckedAt') }
          : {}),
        ...(fstr(row, 'checkoutId') !== undefined
          ? { checkoutId: fstr(row, 'checkoutId') }
          : {}),
        createdAt: fnum(row, 'createdAt') ?? 0,
      };
      return [space];
    })
    .sort(
      (a, b) =>
        a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );

  const chats = doc.overlayRows('chats').flatMap(row => {
    const deviceId = fstr(row, 'deviceId');
    if (deviceId === undefined) return [];
    const cfg = fobj(row, 'config');
    const src = fobj(row, 'sourceContext');
    const sourceContext =
      src !== undefined ? sourceContextFromFields(src) : undefined;
    const chat: Chat = {
      id: fstr(row, 'id') ?? row.id,
      deviceId,
      ...(fstr(row, 'title') !== undefined
        ? { title: fstr(row, 'title') }
        : {}),
      archived: fbool(row, 'archived') ?? false,
      ...(fstr(row, 'cwd') !== undefined ? { cwd: fstr(row, 'cwd') } : {}),
      ...(fstr(row, 'branch') !== undefined
        ? { branch: fstr(row, 'branch') }
        : {}),
      ...(fstr(row, 'checkoutId') !== undefined
        ? { checkoutId: fstr(row, 'checkoutId') }
        : {}),
      ...(sourceContext !== undefined ? { sourceContext } : {}),
      ...(cfg !== undefined ? { config: chatConfigFromFields(cfg) } : {}),
      ...(fstr(row, 'lastMessagePreview') !== undefined
        ? { lastMessagePreview: fstr(row, 'lastMessagePreview') }
        : {}),
      ...(fnum(row, 'lastMessageAt') !== undefined
        ? { lastMessageAt: fnum(row, 'lastMessageAt') }
        : {}),
      createdAt: fnum(row, 'createdAt') ?? 0,
      ...(fstr(row, 'spaceId') !== undefined
        ? { spaceId: fstr(row, 'spaceId') }
        : {}),
      ...(fnum(row, 'lastSeenAt') !== undefined
        ? { lastSeenAt: fnum(row, 'lastSeenAt') }
        : {}),
      ...(fnum(row, 'roomGen') !== undefined
        ? { roomGen: fnum(row, 'roomGen') }
        : {}),
    };
    return [chat];
  });

  const sessions: Record<string, SessionRow> = {};
  for (const row of doc.overlayRows('sessions')) {
    const chatId = fstr(row, 'chatId');
    const deviceId = fstr(row, 'deviceId');
    const status = fstr(row, 'status');
    if (
      chatId === undefined ||
      deviceId === undefined ||
      status === undefined ||
      !SESSION_STATUSES.has(status as SessionStatus)
    ) {
      continue;
    }
    sessions[chatId] = {
      chatId,
      deviceId,
      status: status as SessionStatus,
      ...(fnum(row, 'startedAt') !== undefined
        ? { startedAt: fnum(row, 'startedAt') }
        : {}),
      updatedAt: fnum(row, 'updatedAt') ?? 0,
    };
  }

  return { devices, spaces, chats, sessions };
};

// ── Derived views ──────────────────────────────────────────────────────────

/** state.rs `overview_chats`: every non-archived projectless chat or chat of
 * a live space, attention-sorted. */
export const overviewChats = (w: WorkspaceProjection): Chat[] => {
  const liveSpaceIds = new Set(w.spaces.map(s => s.id));
  const live = w.chats.filter(
    c =>
      !c.archived && (c.spaceId === undefined || liveSpaceIds.has(c.spaceId)),
  );
  return sortActive(live);
};

/** A space's sessions in Sessions order (recency) — the phone has no tabs. */
export const chatsInSpace = (w: WorkspaceProjection, spaceId: string): Chat[] =>
  sortActive(w.chats.filter(c => !c.archived && c.spaceId === spaceId));

/** Archived chats under an optional space scope, recency order. */
export const archivedChats = (
  w: WorkspaceProjection,
  spaceId?: string,
): Chat[] =>
  sortActive(
    w.chats.filter(
      c => c.archived && (spaceId === undefined || c.spaceId === spaceId),
    ),
  );

/** Aggregate most-urgent member status for a space's leading dot. */
export const spaceIndicator = (
  w: WorkspaceProjection,
  spaceId: string,
  nowMs: number,
): ChatIndicator | undefined => {
  const members = chatsInSpace(w, spaceId).map(chat =>
    chatIndicator(chat, effectiveStatus(w.sessions[chat.id], nowMs)),
  );
  return members.reduce<ChatIndicator | undefined>(
    (min, c) => (min === undefined || c < min ? c : min),
    undefined,
  );
};

export const indicatorFor = (
  w: WorkspaceProjection,
  chat: Chat,
  nowMs: number,
): ChatIndicator =>
  chatIndicator(chat, effectiveStatus(w.sessions[chat.id], nowMs));

// ── Write set-shapes (callers pass them to doc.write/deleteRows) ───────────

/** workspace_host.rs create_chat shape: a full-row upsert. Born on chat2 ⇒
 * `roomGen: 2` (empty doc — nothing to seed, no migration race). */
export const buildCreateChatSet = (args: {
  chatId?: string;
  deviceId: string;
  spaceId?: string;
  cwd: string;
  config?: ChatConfig;
  branch?: string;
  nowMs: number;
}): {
  chatId: string;
  kind: string;
  id: string;
  op: 'upsert';
  set: Record<string, FieldValue>;
} => {
  const chatId = args.chatId ?? newId();
  const set: Record<string, FieldValue> = {
    id: chatId,
    deviceId: args.deviceId,
    archived: false,
    cwd: args.cwd,
    createdAt: args.nowMs,
    roomGen: 2,
  };
  if (args.spaceId !== undefined) set.spaceId = args.spaceId;
  if (args.branch !== undefined) set.branch = args.branch;
  if (args.config !== undefined) set.config = chatConfigToFields(args.config);
  return { chatId, kind: 'chats', id: chatId, op: 'upsert', set };
};

export const buildArchivedSet = (
  archived: boolean,
): Record<string, FieldValue> => ({
  archived,
});

/** Synced seen marker (LWW) — caller must apply the monotonic guard: skip
 * the write when the stored stamp is already >= nowMs. */
export const buildMarkSeenSet = (
  nowMs: number,
): Record<string, FieldValue> => ({
  lastSeenAt: nowMs,
});

export const buildRenameSet = (title: string): Record<string, FieldValue> => ({
  title,
});

export const buildChatConfigSet = (
  config: ChatConfig,
): Record<string, FieldValue> => ({
  config: chatConfigToFields(config),
});

export const buildChatCheckoutSet = (
  cwd: string,
  branch: string,
): Record<string, FieldValue> => ({
  cwd,
  branch,
});

/** Retarget the chat at another space on the same host (cwd follows the
 * space path). Branch is left untouched — worktree chips change that. */
export const buildChatSpaceSet = (
  spaceId: string,
  cwd: string,
): Record<string, FieldValue> => ({
  spaceId,
  cwd,
});

/** Tombstone a chat (and its session-status row) in one batch. */
export const buildDeleteChatKeys = (
  chatId: string,
): { kind: string; id: string }[] => [
  { kind: 'chats', id: chatId },
  { kind: 'sessions', id: chatId },
];

/** Hard-delete a space and cascade to its chats: ONE batch tombstones the
 * space row and every chat/session row whose spaceId matches. */
export const buildDeleteSpaceKeys = (
  w: WorkspaceProjection,
  spaceId: string,
): { kind: string; id: string }[] => {
  const keys: { kind: string; id: string }[] = [];
  for (const chat of w.chats) {
    if (chat.spaceId === spaceId) {
      keys.push(
        { kind: 'chats', id: chat.id },
        { kind: 'sessions', id: chat.id },
      );
    }
  }
  keys.push({ kind: 'spaces', id: spaceId });
  return keys;
};

export { chatUnseen, deviceSupports };
