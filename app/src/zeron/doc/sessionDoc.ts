// Ported from zeron@853872d apps/ios/Zeron/Sync/SessionStore.swift
// (decodeEntries/entryFrom/partFrom/queuedFrom ~L436–670, queueCommand,
// sendRun/sendSteer/sendInterrupt/respondInput, adoptLegacyCommands) and
// crates/doc/src/schema.rs (container layout + read_* skip-not-fail policy).
//
// A viewer device never writes message entries; it appends command ledger
// entries (rule 1: append-only, own entries only) and lets the host drain.

import { joinContinuations } from '../protocol/messages';
import {
  COMMAND_DEFAULT_TTL_MS,
  FULL_ACCESS_AUTO_APPROVE,
  FULL_ACCESS_SANDBOX,
  type ContextUsage,
  type ToolDiff,
  type ToolDiffStat,
  type MessageEntry,
  type MessagePart,
  type MessageRole,
  type MessageStatus,
  type QueuedMessage,
  type QueueDeliveryGate,
  type RenderToolCall,
  type RunRequest,
  type SessionCommandEntry,
  type SessionCommandKind,
  type SessionCommandPayload,
  type SessionCommandStatus,
  type UserInputAnswer,
  type UserInputQuestion,
  type WorktreeSpec,
} from '../protocol/types';
import { canComposerCancel } from '../protocol/commands';
import type { LoroDocPort, LoroJsonValue } from './loroPort';

type Json = Record<string, unknown>;

const isObj = (v: unknown): v is Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined =>
  typeof v === 'string' ? v : undefined;
const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined;
const bool = (v: unknown): boolean | undefined =>
  typeof v === 'boolean' ? v : undefined;
const arr = (v: unknown): unknown[] | undefined =>
  Array.isArray(v) ? v : undefined;

/** RFC 4122 v4 lowercase (UUID().uuidString.lowercased() parity). */
export const newId = (): string =>
  (globalThis.crypto as Crypto | undefined)?.randomUUID?.().toLowerCase() ??
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.floor(Math.random() * 16);
    return (c === 'x' ? r : (r % 4) + 8).toString(16);
  });

const IMAGE_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
]);

/** GeneratedImageReference.isValid (Entities.swift): absolute path, no NUL,
 * non-empty name, supported mime. */
const imageValid = (path: string, name: string, mimeType: string): boolean =>
  path.startsWith('/') &&
  !path.includes('\0') &&
  name.length > 0 &&
  IMAGE_MIME_TYPES.has(mimeType);

// ── part / entry decode (SessionStore.partFrom / entryFrom) ─────────────────

export const partFrom = (value: unknown): MessagePart | undefined => {
  if (!isObj(value)) return undefined;
  const id = str(value.id);
  const kind = str(value.kind);
  if (id === undefined || kind === undefined) return undefined;
  switch (kind) {
    case 'text':
      return { kind: 'text', id, text: str(value.text) ?? '' };
    case 'reasoning':
      // The doc carries the body on `reasoning`, never `text` (schema.rs).
      return { kind: 'reasoning', id, text: str(value.reasoning) ?? '' };
    case 'image': {
      const path = str(value.path) ?? '';
      const name = str(value.name) ?? '';
      const mimeType = str(value.mimeType) ?? '';
      if (!imageValid(path, name, mimeType)) {
        return { kind: 'error', id, message: 'Generated image unavailable' };
      }
      return { kind: 'image', id, path, name, mimeType };
    }
    case 'tool': {
      const call = value.call;
      if (!isObj(call)) return { kind: 'text', id, text: '' };
      // `isError` presence IS the resolution marker (schema.rs).
      const isError = bool(value.isError);
      const part: MessagePart = {
        kind: 'tool',
        id,
        call: call as RenderToolCall,
        ...(isError !== undefined ? { isError } : {}),
        resolved: isError !== undefined,
      };
      const output = str(value.output);
      const outputRef = str(value.outputRef);
      const outputBytes = num(value.outputBytes);
      const diffRef = str(value.diffRef);
      const diffStats = arr(value.diffStats);
      const subagentRef = str(value.subagentRef);
      const subagentStatus = str(value.subagentStatus);
      const subagentTail = str(value.subagentTail);
      if (output !== undefined) part.output = output;
      if (outputRef !== undefined) part.outputRef = outputRef;
      if (outputBytes !== undefined) part.outputBytes = outputBytes;
      if (isObj(value.diff)) part.diff = value.diff as unknown as ToolDiff;
      if (diffRef !== undefined) part.diffRef = diffRef;
      if (diffStats !== undefined) part.diffStats = diffStats as ToolDiffStat[];
      if (subagentRef !== undefined) part.subagentRef = subagentRef;
      if (
        subagentStatus === 'running' ||
        subagentStatus === 'done' ||
        subagentStatus === 'failed'
      ) {
        part.subagentStatus = subagentStatus;
      }
      if (subagentTail !== undefined) part.subagentTail = subagentTail;
      return part;
    }
    case 'input': {
      const questions = (arr(value.questions) ?? []).filter(isObj).map(
        (q): UserInputQuestion => ({
          id: str(q.id) ?? '',
          header: str(q.header) ?? '',
          question: str(q.question) ?? '',
          options: (arr(q.options) ?? []).map(o => String(o)),
          ...(bool(q.multiSelect) !== undefined
            ? { multiSelect: bool(q.multiSelect) }
            : {}),
        }),
      );
      // The part id doubles as the requestId (schema.rs to_doc_part).
      return {
        kind: 'input',
        id,
        requestId: id,
        questions,
        resolved: bool(value.resolved) ?? false,
      };
    }
    case 'error':
      return { kind: 'error', id, message: str(value.message) ?? '' };
    default:
      // Unknown kinds (future schema) are dropped, matching iOS.
      return undefined;
  }
};

const ROLES = new Set<MessageRole>(['user', 'assistant', 'system']);
const STATUSES = new Set<MessageStatus>(['streaming', 'complete', 'aborted']);

export const entryFrom = (value: unknown): MessageEntry | undefined => {
  if (!isObj(value)) return undefined;
  const id = str(value.id);
  const role = str(value.role);
  if (id === undefined || role === undefined || !ROLES.has(role as MessageRole))
    return undefined;
  const status = str(value.status);
  return {
    id,
    role: role as MessageRole,
    parts: (arr(value.parts) ?? [])
      .map(partFrom)
      .filter((p): p is MessagePart => p !== undefined),
    createdAt: num(value.createdAt) ?? 0,
    deviceId: str(value.deviceId) ?? '',
    ...(status !== undefined && STATUSES.has(status as MessageStatus)
      ? { status: status as MessageStatus }
      : {}),
    ...(str(value.continuationOf) !== undefined
      ? { continuationOf: str(value.continuationOf) }
      : {}),
  };
};

// ── queue decode (queue.rs queued_from_json) ────────────────────────────────

const gateFrom = (v: unknown): QueueDeliveryGate | undefined => {
  if (!isObj(v)) return undefined;
  // A future gate kind fails closed: review-required, never silently sendable.
  if (v.kind === 'editing') {
    return {
      kind: 'editing',
      leaseId: str(v.leaseId) ?? '',
      ownerDeviceId: str(v.ownerDeviceId) ?? '',
      ownerInstanceId: str(v.ownerInstanceId) ?? '',
      acquiredAtMs: num(v.acquiredAtMs) ?? 0,
      expiresAtMs: num(v.expiresAtMs) ?? 0,
      baseTextHash: str(v.baseTextHash) ?? '',
    };
  }
  return {
    kind: 'reviewRequired',
    previousLeaseId: str(v.previousLeaseId) ?? '',
    ownerDeviceId: str(v.ownerDeviceId) ?? '',
    sinceMs: num(v.sinceMs) ?? 0,
    baseTextHash: str(v.baseTextHash) ?? '',
  };
};

export const queuedFrom = (value: unknown): QueuedMessage | undefined => {
  if (!isObj(value)) return undefined;
  const id = str(value.id)?.trim();
  const text = str(value.text);
  if (!id || text === undefined || text.trim().length === 0) return undefined;
  const attachments = (arr(value.attachments) ?? []).map(a => String(a));
  const editedAt = num(value.editedAt);
  const gate =
    value.deliveryGate == null ? undefined : gateFrom(value.deliveryGate);
  return {
    id,
    text,
    ...(attachments.length > 0 ? { attachments } : {}),
    ...(bool(value.holdForTurnEnd) === true ? { holdForTurnEnd: true } : {}),
    issuedBy: str(value.issuedBy) ?? '',
    issuedAt: num(value.issuedAt) ?? 0,
    ...(editedAt !== undefined ? { editedAt } : {}),
    ...(gate !== undefined ? { deliveryGate: gate } : {}),
  };
};

// ── command decode (schema.rs read_commands — skip malformed) ───────────────

const COMMAND_KINDS = new Set<SessionCommandKind>([
  'run',
  'steer',
  'interrupt',
  'respondInput',
]);
const COMMAND_STATUSES = new Set<SessionCommandStatus>([
  'pending',
  'applied',
  'rejected',
  'expired',
  'superseded',
  'cancelled',
]);

export const commandFrom = (
  value: unknown,
): SessionCommandEntry | undefined => {
  if (!isObj(value)) return undefined;
  const id = str(value.id);
  const kind = str(value.kind);
  const status = str(value.status);
  const issuedBy = str(value.issuedBy);
  const issuedAt = num(value.issuedAt);
  if (
    id === undefined ||
    kind === undefined ||
    !COMMAND_KINDS.has(kind as SessionCommandKind) ||
    status === undefined ||
    !COMMAND_STATUSES.has(status as SessionCommandStatus) ||
    issuedBy === undefined ||
    issuedAt === undefined ||
    !isObj(value.payload)
  ) {
    return undefined;
  }
  const basedOn = isObj(value.basedOn)
    ? {
        ...(value.basedOn.turnId != null
          ? { turnId: str(value.basedOn.turnId) ?? null }
          : {}),
        ...(value.basedOn.frontier != null
          ? { frontier: str(value.basedOn.frontier) ?? null }
          : {}),
      }
    : undefined;
  return {
    id,
    kind: kind as SessionCommandKind,
    payload: value.payload as unknown as SessionCommandPayload,
    issuedBy,
    issuedAt,
    ...(basedOn !== undefined ? { basedOn } : {}),
    ...(num(value.expiresAt) !== undefined
      ? { expiresAt: num(value.expiresAt) }
      : {}),
    status: status as SessionCommandStatus,
    ...(str(value.resolution) !== undefined
      ? { resolution: str(value.resolution) }
      : {}),
  };
};

// ── the doc mirror ──────────────────────────────────────────────────────────

export interface SessionDocMeta {
  chatId?: string;
  schemaVersion?: number;
  contextUsage?: ContextUsage;
}

export interface SessionDocProjection {
  entries: MessageEntry[];
  commands: SessionCommandEntry[];
  queue: QueuedMessage[];
  meta: SessionDocMeta;
}

export class SessionDoc {
  constructor(readonly port: LoroDocPort) {}

  /** Whole-doc decode. `undefined` when the doc has no map root yet — callers
   * leave the previous projection standing rather than blanking a live
   * transcript (SessionStore.decodeEntries). */
  project(): SessionDocProjection | undefined {
    const root = this.port.toJSON();
    if (!isObj(root)) return undefined;
    const entries = joinContinuations(
      (arr(root.messages) ?? [])
        .map(entryFrom)
        .filter((e): e is MessageEntry => e !== undefined),
    );
    const commands = (arr(root.commands) ?? [])
      .map(commandFrom)
      .filter((c): c is SessionCommandEntry => c !== undefined);
    const queue = (arr(root.queue) ?? [])
      .map(queuedFrom)
      .filter((q): q is QueuedMessage => q !== undefined);
    const metaMap = isObj(root.meta) ? root.meta : undefined;
    let contextUsage: ContextUsage | undefined;
    const rawUsage = metaMap ? str(metaMap.contextUsage) : undefined;
    if (rawUsage !== undefined) {
      try {
        const parsed = JSON.parse(rawUsage);
        if (isObj(parsed)) {
          contextUsage = {
            tokens: num(parsed.tokens) ?? null,
            window: num(parsed.window) ?? null,
          };
        }
      } catch {
        contextUsage = undefined;
      }
    }
    return {
      entries,
      commands,
      queue,
      meta: {
        ...(metaMap !== undefined && str(metaMap.chatId) !== undefined
          ? { chatId: str(metaMap.chatId) }
          : {}),
        ...(metaMap !== undefined && num(metaMap.schemaVersion) !== undefined
          ? { schemaVersion: num(metaMap.schemaVersion) }
          : {}),
        ...(contextUsage !== undefined ? { contextUsage } : {}),
      },
    };
  }

  // ── Command plane ──────────────────────────────────────────────────────

  /** schema.rs queue_command / SessionStore.queueCommand, field for field. */
  queueCommand(args: {
    kind: SessionCommandKind;
    payload: SessionCommandPayload;
    deviceId: string;
    nowMs: number;
    basedOnTurnId?: string | null;
    id?: string;
  }): string {
    const id = args.id ?? newId();
    const fields: Record<string, LoroJsonValue> = {
      id,
      kind: args.kind,
      payload: args.payload as unknown as LoroJsonValue,
      issuedBy: args.deviceId,
      issuedAt: args.nowMs,
      ...(args.basedOnTurnId != null
        ? { basedOn: { turnId: args.basedOnTurnId, frontier: null } }
        : {}),
      expiresAt: args.nowMs + COMMAND_DEFAULT_TTL_MS,
      status: 'pending',
    };
    this.port.pushMapToList('commands', fields);
    this.port.commit();
    return id;
  }

  /** SessionQueue.swift enqueueMessage: park a message on the doc's `queue`
   * movable list; the host decides where it goes from there. */
  enqueueMessage(args: {
    text: string;
    deviceId: string;
    nowMs: number;
    attachments?: string[];
    holdForTurnEnd?: boolean;
    id?: string;
  }): string {
    const id = args.id ?? newId();
    this.port.movableList('queue').pushMap({
      id,
      text: args.text,
      issuedBy: args.deviceId,
      issuedAt: args.nowMs,
      ...(args.holdForTurnEnd === true ? { holdForTurnEnd: true } : {}),
      ...(args.attachments !== undefined && args.attachments.length > 0
        ? { attachments: [...args.attachments] }
        : {}),
    });
    this.port.commit();
    return id;
  }

  /** SessionQueue.swift moveQueued: LoroMovableList `mov` — a pure local
   * doc write; the host serializes it like any other update. Returns false
   * when the id isn't in the queue. */
  moveQueued(id: string, toIndex: number): boolean {
    const list = this.port.movableList('queue');
    const count = list.length();
    // Read ids from the projected JSON (the movable-list port exposes no
    // index getter); the projection is by list order.
    const queue = this.project()?.queue ?? [];
    const from = queue.findIndex(q => q.id === id);
    if (from < 0 || count === 0) return false;
    const target = Math.min(Math.max(toIndex, 0), count - 1);
    if (from === target) return false;
    list.move(from, target);
    this.port.commit();
    return true;
  }

  /** Apply a CONFIRMED queue removal locally (performQueueAction deletes
   * only after the host acked — a lost reply is uncertain). */
  removeQueuedLocal(id: string): boolean {
    const queue = this.project()?.queue ?? [];
    const index = queue.findIndex(q => q.id === id);
    if (index < 0) return false;
    this.port.movableList('queue').delete(index, 1);
    this.port.commit();
    return true;
  }

  /** Rule 2: the composer may set `cancelled` on its own still-pending
   * entries. Returns false when the rule does not permit it. */
  cancelOwnCommand(commandId: string, deviceId: string): boolean {
    const root = this.port.toJSON();
    if (!isObj(root)) return false;
    const list = arr(root.commands) ?? [];
    for (let i = 0; i < list.length; i++) {
      const entry = commandFrom(list[i]);
      if (entry?.id === commandId) {
        if (!canComposerCancel(entry, deviceId)) return false;
        this.port.setListMapField('commands', i, 'status', 'cancelled');
        this.port.commit();
        return true;
      }
    }
    return false;
  }

  /**
   * M3 adopt-legacy-commands (SessionStore.adoptLegacyCommands): mine a
   * retired lineage's parsed JSON root for OUR OWN still-pending, unexpired
   * commands and re-queue them with the same ids; basedOn is dropped (its
   * turn ids don't exist in the new lineage). Returns the count carried.
   */
  adoptPendingCommandsFrom(
    legacyRootJson: unknown,
    deviceId: string,
    nowMs: number,
  ): number {
    if (!isObj(legacyRootJson)) return 0;
    const commands = arr(legacyRootJson.commands) ?? [];
    let carried = 0;
    for (const value of commands) {
      if (!isObj(value)) continue;
      if (str(value.status) !== 'pending' || str(value.issuedBy) !== deviceId)
        continue;
      const id = str(value.id);
      const kind = str(value.kind);
      const payload = value.payload;
      if (id === undefined || kind === undefined || payload === undefined)
        continue;
      const expiresAt = num(value.expiresAt);
      if (expiresAt !== undefined && expiresAt <= nowMs) continue;
      this.port.pushMapToList('commands', {
        id,
        kind,
        payload: payload as LoroJsonValue,
        issuedBy: deviceId,
        issuedAt: num(value.issuedAt) ?? nowMs,
        expiresAt: expiresAt ?? nowMs + COMMAND_DEFAULT_TTL_MS,
        status: 'pending',
      });
      carried += 1;
    }
    if (carried > 0) this.port.commit();
    return carried;
  }
}

// ── payload builders (SessionStore.sendRun/sendSteer/sendInterrupt/
//    respondInput) ──────────────────────────────────────────────────────────

export interface RunChatContext {
  config?: {
    harness?: string;
    model?: string;
    reasoning?: string;
    modelOptions?: Record<string, unknown>;
    sandbox?: string;
  };
  cwd?: string;
}

export const buildRunRequest = (
  prompt: string,
  chat: RunChatContext,
  // Phone assumes unattended full access — no sandbox/auto-approve pickers.
  opts: {
    attachments?: string[];
    worktree?: WorktreeSpec;
    autoApprove?: boolean;
  } = {},
): RunRequest => ({
  prompt,
  ...(chat.config?.harness !== undefined
    ? { harness: chat.config.harness }
    : {}),
  model: chat.config?.model ?? null,
  reasoning: (chat.config?.reasoning ?? null) as RunRequest['reasoning'],
  modelOptions: chat.config?.modelOptions ?? {},
  cwd: chat.cwd ?? '',
  sandbox: FULL_ACCESS_SANDBOX,
  autoApprove: opts.autoApprove ?? FULL_ACCESS_AUTO_APPROVE,
  resume: null,
  ...(opts.attachments !== undefined && opts.attachments.length > 0
    ? { attachments: [...opts.attachments] }
    : {}),
  ...(opts.worktree !== undefined ? { worktree: opts.worktree } : {}),
});

export const buildRunCommand = (
  prompt: string,
  chat: RunChatContext,
  opts: {
    attachments?: string[];
    worktree?: WorktreeSpec;
    autoApprove?: boolean;
    messageId?: string;
  } = {},
): SessionCommandPayload => ({
  kind: 'run',
  request: buildRunRequest(prompt, chat, opts),
  messageId: opts.messageId ?? newId(),
});

export const buildSteer = (
  prompt: string,
  messageId?: string,
): SessionCommandPayload => ({
  kind: 'steer',
  prompt,
  messageId: messageId ?? newId(),
});

export const buildInterrupt = (): SessionCommandPayload => ({
  kind: 'interrupt',
});

export const buildRespondInput = (
  requestId: string,
  answers: UserInputAnswer[],
): SessionCommandPayload => ({ kind: 'respondInput', requestId, answers });
