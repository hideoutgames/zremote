// Port of the doc/room half of SessionStore.swift (start/connectIfReady/
// kick/flush + local-update→enqueue + first-contact full-log push +
// cursor+snapshot persistence in ONE docDisk write). Feeds the per-chat
// session store on every projection change; tracks pendingSends and moves
// terminally-rejected sends to failedSends for draft restore.

import type { DocDisk } from '../native/docDisk';
import type { LoroDocPort } from '../doc/loroPort';
import {
  SessionDoc,
  newId,
  buildInterrupt,
  buildRespondInput,
  buildRunCommand,
  buildSteer,
} from '../doc/sessionDoc';
import type {
  SessionCommandPayload,
  UserInputAnswer,
  WorktreeSpec,
} from '../protocol/types';
import type { ChatRoomEvent } from '../transport/chatRoomClient';
import { ChatRoomClient } from '../transport/chatRoomClient';
import type { Clock } from '../transport/clock';
import type { EdgeConfig } from '../transport/edge';
import { nudgeHost } from '../transport/nudge';
import type { TokenSource } from '../transport/tokenSource';
import type { WsFactory } from '../transport/ws';
import type { FetchImpl } from '../transport/edgeHttp';
import { getSessionStore, type FailedSend } from '../state/sessionStores';

export interface SessionControllerDeps {
  cfg: EdgeConfig;
  tokenSource: TokenSource;
  deviceId: string;
  orgId: string;
  userId: string;
  wsFactory: WsFactory;
  clock: Clock;
  docDisk: DocDisk;
  loro: () => LoroDocPort;
  fetchImpl?: FetchImpl;
  log?: (line: string) => void;
  /** Workspace lookup for host device + roomGen (connectIfReady). */
  chatMeta: () => { hostDeviceId?: string; roomGen?: number };
}

const PERSIST_DEBOUNCE_MS = 500;
const TERMINAL_BAD = new Set([
  'rejected',
  'expired',
  'superseded',
  'cancelled',
]);

export class SessionController {
  readonly chatId: string;
  private readonly deps: SessionControllerDeps;
  private port: LoroDocPort;
  private doc: SessionDoc;
  private room: ChatRoomClient | undefined;
  private cursor = 0;
  private started = false;
  private refCount = 0;
  private unsub: (() => void) | undefined;
  private persistTimer: unknown;
  /** messageId → commandId for run/steer sends (failedSend bookkeeping). */
  private commandByMessage = new Map<string, string>();

  constructor(chatId: string, deps: SessionControllerDeps) {
    this.chatId = chatId;
    this.deps = deps;
    this.port = deps.loro();
    this.doc = new SessionDoc(this.port);
  }

  // ── Lifecycle (SessionStore.start/connectIfReady/release) ────────────

  retain(): this {
    this.refCount += 1;
    return this;
  }

  release(): void {
    this.refCount -= 1;
    if (this.refCount <= 0) this.stop();
  }

  get refs(): number {
    return this.refCount;
  }

  /** False once stopped (released to zero / runtime stopped) — the runtime
   * recreates instead of reusing a dead controller. */
  get isActive(): boolean {
    return this.started;
  }

  /** Loads persisted state, wires the local-update→enqueue subscription,
   * pushes the full log on first contact, then (roomGen permitting) starts
   * the room. Mirrors SessionStore.start ordering. */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    const { docDisk, orgId, userId } = this.deps;
    const saved = await docDisk
      .loadChat2(orgId, userId, this.chatId)
      .catch(() => undefined);
    if (saved !== undefined) {
      try {
        this.port.import(Buffer.from(saved.snapshot, 'base64'));
        this.cursor = saved.cursor;
      } catch {
        this.cursor = 0;
      }
    }
    this.unsub = this.port.subscribeLocalUpdates(bytes =>
      this.room?.enqueue(bytes),
    );
    this.connectIfReady();
  }

  /** SessionStore.connectIfReady: rooms only exist at generation ≥ 2. */
  connectIfReady(): void {
    if (this.room !== undefined) return;
    const gen = this.deps.chatMeta().roomGen;
    if (gen !== undefined && gen < 2) return;
    this.makeRoom().start();
  }

  private makeRoom(): ChatRoomClient {
    const store = getSessionStore(this.chatId);
    const room = new ChatRoomClient({
      cfg: this.deps.cfg,
      chatId: this.chatId,
      deviceId: this.deps.deviceId,
      wsFactory: this.deps.wsFactory,
      tokenSource: this.deps.tokenSource,
      clock: this.deps.clock,
      fetchImpl: this.deps.fetchImpl,
      log: this.deps.log,
      delegate: {
        cursor: () => this.cursor,
        containsFrontier: bytes => this.port.oplogIncludes(bytes),
        applyCheckpoint: (bytes, seq) => {
          try {
            this.port.import(bytes);
          } catch {
            return false;
          }
          this.cursor = Math.max(this.cursor, seq);
          this.project();
          return true;
        },
        applyRow: (bytes, seq) => {
          try {
            this.port.import(bytes);
          } catch {
            /* malformed row — cursor still advances (skip-not-fail) */
          }
          this.cursor = Math.max(this.cursor, seq);
          this.project();
        },
        advanceCursor: seq => {
          this.cursor = Math.max(this.cursor, seq);
        },
        clampCursor: seq => {
          this.cursor = Math.min(this.cursor, seq);
        },
        setCursor: seq => {
          this.cursor = seq;
        },
        onEvent: ev => this.onRoomEvent(ev),
      },
    });
    this.room = room;
    store.setState({ room: 'connecting' });
    // First contact: push the complete local update log when the cursor is
    // 0 (SessionStore.start — the room replays it after reconnect).
    if (this.cursor === 0) {
      const all = this.port.exportUpdatesFrom(null);
      if (all.length > 0) room.enqueue(all);
    }
    return room;
  }

  private onRoomEvent(ev: ChatRoomEvent): void {
    const store = getSessionStore(this.chatId);
    switch (ev.t) {
      case 'connected':
        store.setState({ room: 'connected' });
        break;
      case 'caughtUp':
        store.setState({ room: 'caughtUp' });
        break;
      case 'disconnected':
        store.setState({ room: 'disconnected' });
        break;
      case 'error':
        store.setState({ lastError: `${ev.code}: ${ev.message}` });
        break;
      case 'pushAcked':
        this.cursor = Math.max(this.cursor, ev.seq);
        // The acked batch covers every update enqueued so far.
        store.setState({ unsyncedCommandIds: [] });
        this.schedulePersist();
        break;
      case 'presence':
        break;
    }
  }

  /** Re-derive store state from the doc; reconcile pending/failed sends. */
  project(): void {
    const proj = this.doc.project();
    if (proj === undefined) return;
    const store = getSessionStore(this.chatId);
    const s = store.getState();
    const entryIds = new Set(proj.entries.map(e => e.id));
    const pendingSends = s.pendingSends.filter(p => !entryIds.has(p.messageId));
    const failedSends = [...s.failedSends];
    const stillPending = pendingSends.filter(p => {
      const commandId = this.commandByMessage.get(p.messageId);
      if (commandId === undefined) return true;
      const cmd = proj.commands.find(c => c.id === commandId);
      if (cmd !== undefined && TERMINAL_BAD.has(cmd.status)) {
        failedSends.push({
          ...p,
          commandId,
          status: cmd.status as FailedSend['status'],
        });
        return false;
      }
      return true;
    });
    store.setState({
      entries: proj.entries,
      commands: proj.commands,
      queue: proj.queue,
      meta: proj.meta,
      pendingSends: stillPending,
      failedSends,
      hostDeviceId: this.deps.chatMeta().hostDeviceId,
    });
    this.schedulePersist();
  }

  private schedulePersist(): void {
    const { clock } = this.deps;
    if (this.persistTimer !== undefined) clock.clearTimeout(this.persistTimer);
    this.persistTimer = clock.setTimeout(() => {
      this.persistTimer = undefined;
      this.flush().catch(() => {});
    }, PERSIST_DEBOUNCE_MS);
  }

  /** Snapshot + cursor in ONE write (SessionStore saver). */
  async flush(): Promise<void> {
    await this.deps.docDisk.saveChat2(
      this.deps.orgId,
      this.deps.userId,
      this.chatId,
      {
        snapshot: Buffer.from(this.port.exportSnapshot()).toString('base64'),
        cursor: this.cursor,
      },
    );
  }

  kick(): void {
    this.room?.kick();
  }

  stop(): void {
    this.unsub?.();
    this.unsub = undefined;
    this.room?.stop();
    this.room = undefined;
    this.started = false;
    if (this.persistTimer !== undefined) {
      this.deps.clock.clearTimeout(this.persistTimer);
      this.persistTimer = undefined;
    }
    this.flush().catch(() => {});
    getSessionStore(this.chatId).setState({ room: 'idle' });
  }

  // ── Command plane ────────────────────────────────────────────────────

  private basedOn(): string | undefined {
    return this.doc.project()?.entries.at(-1)?.id;
  }

  private send(payload: SessionCommandPayload, basedOnTurnId?: string): string {
    const commandId = this.doc.queueCommand({
      kind: payload.kind,
      payload,
      deviceId: this.deps.deviceId,
      nowMs: this.deps.clock.now(),
      basedOnTurnId: basedOnTurnId ?? this.basedOn() ?? null,
    });
    const store = getSessionStore(this.chatId);
    store.setState(s => ({
      unsyncedCommandIds: [...s.unsyncedCommandIds, commandId],
    }));
    this.project();
    const host = this.deps.chatMeta().hostDeviceId;
    if (host !== undefined) {
      nudgeHost(
        this.deps.cfg,
        this.deps.tokenSource,
        host,
        this.chatId,
        this.deps.fetchImpl,
      ).catch(() => {});
    }
    return commandId;
  }

  sendRun(
    text: string,
    chat: {
      config?: Parameters<typeof buildRunCommand>[1]['config'];
      cwd?: string;
    },
    opts: { attachments?: string[]; worktree?: WorktreeSpec } = {},
  ): string {
    const messageId = newId();
    const payload = buildRunCommand(text, chat, { ...opts, messageId });
    const commandId = this.send(payload);
    this.commandByMessage.set(messageId, commandId);
    const store = getSessionStore(this.chatId);
    const now = this.deps.clock.now();
    store.setState(s => ({
      pendingSends: [
        ...s.pendingSends,
        { messageId, text, at: now, started: now },
      ],
    }));
    return commandId;
  }

  sendSteer(text: string): string {
    const messageId = newId();
    const payload = buildSteer(text, messageId);
    const commandId = this.send(payload);
    this.commandByMessage.set(messageId, commandId);
    const store = getSessionStore(this.chatId);
    const now = this.deps.clock.now();
    store.setState(s => ({
      pendingSends: [
        ...s.pendingSends,
        { messageId, text, at: now, started: now },
      ],
    }));
    return commandId;
  }

  interrupt(): string {
    return this.send(buildInterrupt());
  }

  respondInput(requestId: string, answers: UserInputAnswer[]): string {
    return this.send(buildRespondInput(requestId, answers));
  }

  cancelOwnCommand(commandId: string): boolean {
    const ok = this.doc.cancelOwnCommand(commandId, this.deps.deviceId);
    if (ok) this.project();
    return ok;
  }
}
