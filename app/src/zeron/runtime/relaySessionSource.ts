// Loro-free session backend ("relay mode"): the transcript is projected from
// the host's `WatchDocMessages` stream (`TranscriptFrame` deltas, first item
// always a full reset — `crates/doc/src/transcript_delta.rs`), the queue from
// `WatchQueue`, and commands go through `QueueCommand` (all relay-forwardable
// per `crates/engine/src/rpc.rs` `forwardable`). No session doc lives on the
// phone; the host is authoritative. Used when the Loro native module is
// unavailable (Expo Go) or `forceRelayMode` is set.

import type { Clock } from '../transport/clock';
import type { RelayLike } from '../attachments/upload';
import { METHODS } from '../protocol/rpc';
import { joinContinuations } from '../protocol/messages';
import type {
  ContextUsage,
  MessageEntry,
  MessagePart,
  QueuedMessage,
  SessionCommandEntry,
  SessionCommandPayload,
  UserInputAnswer,
  WorktreeSpec,
} from '../protocol/types';
import { entryFrom, queuedFrom, newId } from '../doc/sessionDoc';
import {
  buildInterrupt,
  buildRespondInput,
  buildRunCommand,
  buildSteer,
} from '../doc/sessionDoc';
import {
  getSessionStore,
  type FailedSend,
  type PendingSend,
} from '../state/sessionStores';

// ── Transcript frame protocol (transcript_delta.rs) ────────────────────

/** `TranscriptUpsert`: `after: None` inserts at the head. */
export interface TranscriptUpsert {
  after?: string | null;
  entry: MessageEntry;
}

/** `TextAppend`: a pure text-tail growth; `len` is the EXPECTED UTF-8 byte
 * length of the target part after appending (a desync tripwire). */
export interface TextAppend {
  entry: string;
  part: string;
  text: string;
  len: number;
}

/** Untagged wire frame: `{reset:[…]}` or `{upsert,append,remove,count}`. */
export type TranscriptFrame =
  | { reset: MessageEntry[] }
  | {
      upsert: TranscriptUpsert[];
      append: TextAppend[];
      remove: string[];
      count: number;
    };

/** `TranscriptUpdate` — frame fields are flattened; contextUsage rides on
 * the same JSON object. */
export interface TranscriptUpdate extends Record<string, unknown> {
  contextUsage?: ContextUsage;
}

export class TranscriptDesync extends Error {}

const utf8Encoder = new TextEncoder();
const utf8Len = (s: string): number => utf8Encoder.encode(s).length;

const normalizeEntry = (value: unknown): MessageEntry => {
  const e = entryFrom(value);
  if (e === undefined) throw new TranscriptDesync('malformed entry in frame');
  return e;
};

/** Port of `apply_transcript_frame`: mutates `current`. On any error the
 * state is unreliable — the caller must resubscribe for a reset. */
export const applyTranscriptFrame = (
  current: MessageEntry[],
  frame: TranscriptFrame,
): void => {
  if ('reset' in frame) {
    const next = frame.reset.map(normalizeEntry);
    current.length = 0;
    current.push(...next);
    return;
  }
  const { upsert, append, remove, count } = frame;
  if (remove.length > 0) {
    const gone = new Set(remove);
    for (let i = current.length - 1; i >= 0; i--) {
      if (gone.has(current[i].id)) current.splice(i, 1);
    }
  }
  for (const u of upsert) {
    const entry = normalizeEntry(u.entry);
    const existing = current.findIndex(e => e.id === entry.id);
    if (existing >= 0) current.splice(existing, 1);
    let at = 0;
    if (u.after !== undefined && u.after !== null) {
      const ix = current.findIndex(e => e.id === u.after);
      if (ix < 0)
        throw new TranscriptDesync(`missing anchor ${String(u.after)}`);
      at = ix + 1;
    }
    current.splice(at, 0, entry);
  }
  for (const a of append) {
    const target = current.find(e => e.id === a.entry);
    if (target === undefined)
      throw new TranscriptDesync(`missing append entry ${a.entry}`);
    const tail = target.parts.find(
      (p): p is Extract<MessagePart, { kind: 'text' | 'reasoning' }> =>
        (p.kind === 'text' || p.kind === 'reasoning') && p.id === a.part,
    );
    if (tail === undefined)
      throw new TranscriptDesync(`missing append part ${a.part}`);
    tail.text += a.text;
    if (utf8Len(tail.text) !== a.len)
      throw new TranscriptDesync(
        `append length mismatch on ${a.entry}#${a.part}: have ${utf8Len(
          tail.text,
        )}, expected ${a.len}`,
      );
  }
  if (current.length !== count)
    throw new TranscriptDesync(
      `count mismatch: have ${current.length}, expected ${count}`,
    );
};

export const parseTranscriptUpdate = (value: unknown): TranscriptUpdate => {
  if (typeof value !== 'object' || value === null)
    throw new TranscriptDesync('non-object transcript update');
  return value as TranscriptUpdate;
};

const frameOf = (u: TranscriptUpdate): TranscriptFrame => {
  if (Array.isArray(u.reset)) return { reset: u.reset as MessageEntry[] };
  const rest = { ...u };
  delete rest.contextUsage;
  return rest as unknown as TranscriptFrame;
};

// ── RelaySessionSource ─────────────────────────────────────────────────

export interface RelaySessionDeps {
  deviceId: string;
  clock: Clock;
  /** Host relay lookup (workspace row's hostDeviceId). */
  relayFor: (deviceId: string) => RelayLike | undefined;
  chatMeta: () => { hostDeviceId?: string; roomGen?: number };
  /** The sessions row (workspaceStore) — interrupt holds `stopping` until
   * it leaves `working`. */
  sessionRow?: () => { status?: string; updatedAt?: number } | undefined;
  log?: (line: string) => void;
}

const REOPEN_MS = 1_000;
/** Terminal host-reported session statuses that release `stopping`. */
const NOT_WORKING = new Set(['idle', 'completed', 'errored', 'aborted']);

/**
 * The relay half of the SessionSource seam. Feeds the same per-chat
 * session store as the doc path: `entries` (+`meta.contextUsage`) from
 * `WatchDocMessages`, `queue` from `WatchQueue`, synthetic `commands`
 * entries for `runPhase` (the host keeps the real ledger — `ListCommands`
 * is the harness slash-command listing, NOT command status, so there is
 * no command-status RPC to poll).
 */
export class RelaySessionSource {
  private readonly entries: MessageEntry[] = [];
  private streams: { items: AsyncIterable<unknown>; cancel(): void }[] = [];
  private reopenTimer: unknown;
  private stopped = false;
  private started = false;
  private desynced = false;
  /** Own command ids issued through QueueCommand, minted entries included —
   * runPhase's pending set. */
  private ownCommands = new Map<string, SessionCommandEntry>();
  /** messageId → commandId (failedSend bookkeeping parity with doc mode). */
  private commandByMessage = new Map<string, string>();

  constructor(
    private readonly chatId: string,
    private readonly deps: RelaySessionDeps,
  ) {}

  get isActive(): boolean {
    return this.started && !this.stopped;
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.stopped = false;
    this.openStreams();
  }

  stop(): void {
    this.stopped = true;
    this.started = false;
    for (const s of this.streams) s.cancel();
    this.streams = [];
    if (this.reopenTimer !== undefined) {
      this.deps.clock.clearTimeout(this.reopenTimer);
      this.reopenTimer = undefined;
    }
    getSessionStore(this.chatId).setState({ room: 'idle' });
  }

  /** kick()/connectIfReady() parity: reopen after teardown or once the
   * workspace row reveals the host device. */
  kick(): void {
    if (this.started && !this.stopped && this.streams.length === 0)
      this.openStreams();
  }

  // ── Streams ──────────────────────────────────────────────────────────

  private hostRelay(): RelayLike {
    const host = this.deps.chatMeta().hostDeviceId;
    if (host === undefined) throw new Error('chat has no host device');
    const relay = this.deps.relayFor(host);
    if (relay === undefined) throw new Error('host offline');
    return relay;
  }

  private openStreams(): void {
    if (this.streams.length > 0 || this.stopped) return;
    let relay: RelayLike;
    try {
      relay = this.hostRelay();
      if (relay.stream === undefined) throw new Error('relay cannot stream');
    } catch {
      this.scheduleReopen();
      return;
    }
    const store = getSessionStore(this.chatId);
    store.setState({ room: 'connecting' });
    const open = async (
      method: string,
      onItem: (v: unknown) => void,
    ): Promise<void> => {
      const stream = await relay.stream!<unknown>(method, {
        chatId: this.chatId,
      });
      if (this.stopped) {
        stream.cancel();
        return;
      }
      this.streams.push(stream);
      if (this.streams.length === 2) store.setState({ room: 'caughtUp' });
      try {
        for await (const item of stream.items) {
          if (this.stopped) return;
          onItem(item);
        }
      } catch (e) {
        if (!this.stopped)
          store.setState({ lastError: `${method} stream: ${e}` });
      }
      if (!this.stopped) this.scheduleReopen();
    };
    open(METHODS.WATCH_DOC_MESSAGES, v => this.onTranscript(v)).catch(e => {
      if (!this.stopped) {
        store.setState({ lastError: `WatchDocMessages: ${e}` });
        this.scheduleReopen();
      }
    });
    open(METHODS.WATCH_QUEUE, v => this.onQueue(v)).catch(e => {
      if (!this.stopped) {
        store.setState({ lastError: `WatchQueue: ${e}` });
        this.scheduleReopen();
      }
    });
  }

  private scheduleReopen(): void {
    if (this.stopped || this.reopenTimer !== undefined) return;
    // Teardown: the next open re-subscribes; the stream's first frame is a
    // full reset, so replacement (not merge) is the reconnect semantic.
    for (const s of this.streams) s.cancel();
    this.streams = [];
    getSessionStore(this.chatId).setState({ room: 'disconnected' });
    this.reopenTimer = this.deps.clock.setTimeout(() => {
      this.reopenTimer = undefined;
      this.openStreams();
    }, REOPEN_MS);
  }

  private onTranscript(value: unknown): void {
    try {
      const update = parseTranscriptUpdate(value);
      applyTranscriptFrame(this.entries, frameOf(update));
      this.desynced = false;
      const store = getSessionStore(this.chatId);
      const entryIds = new Set(this.entries.map(e => e.id));
      const s = store.getState();
      // Reconcile pendingSends: an entry carrying the message id is the
      // host-minted landing (doc mode uses the same id check).
      const pendingSends = s.pendingSends.filter(
        p => !entryIds.has(p.messageId),
      );
      // Own commands whose message landed are applied host-side.
      for (const [id, c] of this.ownCommands) {
        if (c.status !== 'pending') continue;
        const mid =
          c.payload.kind === 'run' || c.payload.kind === 'steer'
            ? c.payload.messageId ?? undefined
            : undefined;
        if (mid !== undefined && entryIds.has(mid))
          this.ownCommands.set(id, { ...c, status: 'applied' });
        if (c.kind === 'interrupt') {
          const row = this.deps.sessionRow?.();
          if (row !== undefined && NOT_WORKING.has(row.status ?? ''))
            this.ownCommands.set(id, { ...c, status: 'applied' });
        }
      }
      store.setState({
        entries: joinContinuations(this.entries),
        commands: [...this.ownCommands.values()],
        meta: {
          chatId: this.chatId,
          ...(update.contextUsage !== undefined
            ? { contextUsage: update.contextUsage }
            : {}),
        },
        pendingSends,
        hostDeviceId: this.deps.chatMeta().hostDeviceId,
      });
    } catch (e) {
      if (e instanceof TranscriptDesync) {
        // Diverged copy is unsafe: drop it and resubscribe for a reset.
        this.desynced = true;
        this.entries.length = 0;
        this.deps.log?.(`transcript desync: ${e.message}`);
        this.scheduleReopen();
      } else {
        throw e;
      }
    }
  }

  private onQueue(value: unknown): void {
    const items =
      typeof value === 'object' && value !== null
        ? (value as { items?: unknown[] }).items
        : undefined;
    if (!Array.isArray(items)) return;
    getSessionStore(this.chatId).setState({
      queue: items
        .map(queuedFrom)
        .filter((q): q is QueuedMessage => q !== undefined),
    });
  }

  // ── Command plane ────────────────────────────────────────────────────

  private async send(
    payload: SessionCommandPayload,
    pending?: PendingSend,
  ): Promise<string> {
    const relay = this.hostRelay();
    const store = getSessionStore(this.chatId);
    try {
      const reply = await relay.call<{ commandId?: string }>(
        METHODS.QUEUE_COMMAND,
        { chatId: this.chatId, command: payload },
      );
      const commandId =
        typeof reply?.commandId === 'string' ? reply.commandId : newId();
      // The host minted the ledger row durably (QueueCommand returns only
      // after queue_command_with_transfers committed) — for runPhase the
      // command is already `synchronized` (NOT in unsyncedCommandIds).
      this.ownCommands.set(commandId, {
        id: commandId,
        kind: payload.kind,
        payload,
        issuedBy: this.deps.deviceId,
        issuedAt: this.deps.clock.now(),
        status: 'pending',
      });
      store.setState({ commands: [...this.ownCommands.values()] });
      return commandId;
    } catch (e) {
      if (pending !== undefined) {
        store.setState(s => ({
          pendingSends: s.pendingSends.filter(
            p => p.messageId !== pending.messageId,
          ),
          failedSends: [
            ...s.failedSends,
            {
              ...pending,
              commandId: 'relay-rejected',
              status: 'rejected' as FailedSend['status'],
            },
          ],
        }));
      }
      throw e;
    }
  }

  sendRun(
    text: string,
    chat: {
      config?: Parameters<typeof buildRunCommand>[1]['config'];
      cwd?: string;
    },
    opts: {
      attachments?: string[];
      worktree?: WorktreeSpec;
      autoApprove?: boolean;
    } = {},
  ): void {
    const messageId = newId();
    const payload = buildRunCommand(text, chat, { ...opts, messageId });
    const now = this.deps.clock.now();
    const pending: PendingSend = { messageId, text, at: now, started: now };
    getSessionStore(this.chatId).setState(s => ({
      pendingSends: [...s.pendingSends, pending],
    }));
    this.send(payload, pending)
      .then(commandId => this.commandByMessage.set(messageId, commandId))
      .catch(() => {});
  }

  sendSteer(text: string): void {
    const messageId = newId();
    const payload = buildSteer(text, messageId);
    const now = this.deps.clock.now();
    const pending: PendingSend = { messageId, text, at: now, started: now };
    getSessionStore(this.chatId).setState(s => ({
      pendingSends: [...s.pendingSends, pending],
    }));
    this.send(payload, pending)
      .then(commandId => this.commandByMessage.set(messageId, commandId))
      .catch(() => {});
  }

  interrupt(): void {
    this.send(buildInterrupt()).catch(() => {});
  }

  respondInput(requestId: string, answers: UserInputAnswer[]): void {
    this.send(buildRespondInput(requestId, answers)).catch(() => {});
  }

  // ── Shared queue (host-authoritative via RPC) ────────────────────────

  async queueMessage(
    text: string,
    opts: { attachments?: string[]; holdForTurnEnd?: boolean } = {},
  ): Promise<string> {
    const reply = await this.hostRelay().call<{ id?: string }>(
      METHODS.QUEUE_MESSAGE,
      {
        chatId: this.chatId,
        text,
        attachments: opts.attachments ?? [],
        holdForTurnEnd: opts.holdForTurnEnd ?? false,
      },
    );
    return typeof reply?.id === 'string' ? reply.id : newId();
  }

  async moveQueued(id: string, toIndex: number): Promise<boolean> {
    const reply = await this.hostRelay().call<{ changed?: boolean }>(
      METHODS.MOVE_QUEUED_MESSAGE,
      { chatId: this.chatId, id, toIndex },
    );
    return reply?.changed === true;
  }

  get desync(): boolean {
    return this.desynced;
  }
}
