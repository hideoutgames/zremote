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
import {
  getSessionStore,
  type FailedSend,
  type RunPhase,
} from '../state/sessionStores';
import { updateAttachment, type StagedAttachment } from '../state/draftStore';
import { withAttachments } from '../protocol/messages';
import { uploadAttachmentChunked, type RelayLike } from '../attachments/upload';
import { AttachmentEscort, pendingRefsFor } from '../attachments/escort';
import { harnessInlinesAttachments } from '../attachments/validate';
import { sendPlan, type SendPlan } from '../attachments/sendPlan';
import { RelaySessionSource } from './relaySessionSource';
import { workspaceStore } from '../state/workspaceStore';

export type SessionMode = 'doc' | 'relay';

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
  /** Host relay lookup for queue actions + attachment uploads. Optional so
   * tests that never touch those paths needn't stub it; queue/upload
   * methods throw when absent. */
  relayFor?: (deviceId: string) => RelayLike | undefined;
  /** Reads a staged file's bytes as base64 (expo-file-system on device). */
  readFileBase64?: (uri: string) => Promise<string>;
  /** Host capability strings for the chat's host device (workspace row). */
  hostCapabilities?: () => ReadonlySet<string>;
  /** 'relay' = Loro-free host-authoritative session (Expo Go / fallback).
   * Default 'doc'. */
  sessionMode?: SessionMode;
}

/** Queue actions against the host — SessionQueue.swift performQueueAction.
 * The host serializes these with delivery; a row is never deleted locally
 * before its ACK (a lost reply is uncertain, sync reconciles). */
export type QueueActionKind = 'sendNow' | 'steerNow' | 'remove';

const QUEUE_ACTION_METHOD: Record<QueueActionKind, string> = {
  sendNow: 'SendQueuedMessageNow',
  steerNow: 'SteerQueuedMessageNow',
  remove: 'RemoveQueuedMessage',
};

const queueActionAcked = (
  reply: { sent?: boolean; removed?: boolean },
  action: QueueActionKind,
): boolean => (action === 'remove' ? reply.removed : reply.sent) === true;

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
  private readonly mode: SessionMode;
  /** Doc-mode only — never constructed in relay mode (deps.loro() may
   * throw there). */
  private port!: LoroDocPort;
  private doc!: SessionDoc;
  private relay: RelaySessionSource | undefined;
  private room: ChatRoomClient | undefined;
  private cursor = 0;
  private started = false;
  private refCount = 0;
  private unsub: (() => void) | undefined;
  private persistTimer: unknown;
  /** messageId → commandId for run/steer sends (failedSend bookkeeping). */
  private commandByMessage = new Map<string, string>();
  /** Staged-attachment ids whose in-flight upload must abort between
   * chunks (composer ✕ during a legacy send). */
  private abortedUploads = new Set<string>();

  constructor(chatId: string, deps: SessionControllerDeps) {
    this.chatId = chatId;
    this.deps = deps;
    this.mode = deps.sessionMode ?? 'doc';
    if (this.mode === 'relay') {
      this.relay = new RelaySessionSource(chatId, {
        deviceId: deps.deviceId,
        clock: deps.clock,
        relayFor: id => deps.relayFor?.(id),
        chatMeta: deps.chatMeta,
        sessionRow: () => workspaceStore.getState().sessions[chatId],
        log: deps.log,
      });
    } else {
      this.port = deps.loro();
      this.doc = new SessionDoc(this.port);
    }
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
    if (this.relay !== undefined) {
      this.relay.start();
      return;
    }
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
    if (this.relay !== undefined) {
      this.relay.kick();
      return;
    }
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
    if (this.relay !== undefined) return;
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
    // Relay sessions never persist a session doc — the host is authoritative.
    if (this.relay !== undefined) return;
    const { clock } = this.deps;
    if (this.persistTimer !== undefined) clock.clearTimeout(this.persistTimer);
    this.persistTimer = clock.setTimeout(() => {
      this.persistTimer = undefined;
      this.flush().catch(() => {});
    }, PERSIST_DEBOUNCE_MS);
  }

  /** Snapshot + cursor in ONE write (SessionStore saver). */
  async flush(): Promise<void> {
    if (this.relay !== undefined) return;
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
    if (this.relay !== undefined) {
      this.relay.kick();
      return;
    }
    this.room?.kick();
  }

  stop(): void {
    if (this.relay !== undefined) {
      this.relay.stop();
      this.started = false;
      return;
    }
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
    opts: {
      attachments?: string[];
      worktree?: WorktreeSpec;
      autoApprove?: boolean;
    } = {},
  ): string {
    const messageId = newId();
    const payload = buildRunCommand(text, chat, { ...opts, messageId });
    if (this.relay !== undefined) {
      this.relay.sendRun(text, chat, opts);
      return '';
    }
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
    if (this.relay !== undefined) {
      this.relay.sendSteer(text);
      return '';
    }
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
    if (this.relay !== undefined) {
      this.relay.interrupt();
      return '';
    }
    return this.send(buildInterrupt());
  }

  respondInput(requestId: string, answers: UserInputAnswer[]): string {
    if (this.relay !== undefined) {
      this.relay.respondInput(requestId, answers);
      return '';
    }
    return this.send(buildRespondInput(requestId, answers));
  }

  cancelOwnCommand(commandId: string): boolean {
    // Relay mode: the command was committed host-side by QueueCommand —
    // there is no cancel RPC (ListCommands is the harness slash-command
    // listing, not command status). Stop (interrupt) is the escape hatch.
    if (this.relay !== undefined) return false;
    const ok = this.doc.cancelOwnCommand(commandId, this.deps.deviceId);
    if (ok) this.project();
    return ok;
  }

  // ── Shared queue (SessionQueue.swift) ────────────────────────────────

  /** enqueueMessage: park a message on the doc's `queue` movable list. */
  queueMessage(
    text: string,
    opts: { attachments?: string[]; holdForTurnEnd?: boolean } = {},
  ): string {
    if (this.relay !== undefined) {
      // Host mints the row id; WatchQueue lands it in store.queue.
      this.relay.queueMessage(text, opts).catch(e => {
        getSessionStore(this.chatId).setState({
          queueActionError: `Couldn't queue the message: ${e}`,
        });
      });
      return '';
    }
    const id = this.doc.enqueueMessage({
      text,
      deviceId: this.deps.deviceId,
      nowMs: this.deps.clock.now(),
      attachments: opts.attachments,
      holdForTurnEnd: opts.holdForTurnEnd,
    });
    this.project();
    this.nudge();
    return id;
  }

  /** moveQueued: a pure local movable-list write in doc mode; a
   * `MoveQueuedMessage` RPC in relay mode. */
  moveQueued(id: string, toIndex: number): boolean {
    if (this.relay !== undefined) {
      this.relay.moveQueued(id, toIndex).catch(() => {});
      return false;
    }
    const ok = this.doc.moveQueued(id, toIndex);
    if (ok) {
      this.project();
      this.nudge();
    }
    return ok;
  }

  private hostRelay(): RelayLike {
    const host = this.deps.chatMeta().hostDeviceId;
    if (host === undefined) throw new Error('chat has no host device');
    const relay = this.deps.relayFor?.(host);
    if (relay === undefined) throw new Error('host offline');
    return relay;
  }

  /** performQueueAction — sends the RPC, applies a CONFIRMED removal
   * locally, and kicks the room on an unacknowledged reply. Requires the
   * host's `message-queue-actions-v1` capability. */
  async queueAction(id: string, action: QueueActionKind): Promise<boolean> {
    const store = getSessionStore(this.chatId);
    const row = store.getState().queue.find(q => q.id === id);
    if (row === undefined) return false;
    // deliveryGate'd rows are held for turn end — no actions.
    if (action !== 'remove' && row.deliveryGate != null) return false;
    store.setState(s => ({
      queueActionsPending: new Set([...s.queueActionsPending, id]),
      queueActionError: undefined,
    }));
    try {
      const reply = await this.hostRelay().call<{
        sent?: boolean;
        removed?: boolean;
      }>(QUEUE_ACTION_METHOD[action], { chatId: this.chatId, id });
      if (!queueActionAcked(reply, action)) {
        store.setState(() => ({
          queueActionError:
            'The host did not confirm the action. The message may have already left the queue.',
        }));
        this.kick();
        return false;
      }
      if (action === 'remove' && this.relay === undefined) {
        this.doc.removeQueuedLocal(id);
        this.project();
      }
      return true;
    } catch (e) {
      store.setState(() => ({
        queueActionError: `Couldn't complete the queue action: ${e}`,
      }));
      this.kick();
      return false;
    } finally {
      store.setState(s => {
        const next = new Set(s.queueActionsPending);
        next.delete(id);
        return { queueActionsPending: next };
      });
    }
  }

  // ── Attachments (ComposerView/Attachments.swift send routing) ────────

  /** Route a draft's staged attachments per `sendPlan` and send. Never puts
   * a device-local URI on the wire. Returns the plan taken; 'blocked'
   * means the caller must surface the refusal. */
  async sendWithAttachments(
    text: string,
    chat: {
      config?: Parameters<typeof buildRunCommand>[1]['config'];
      cwd?: string;
    },
    staged: readonly StagedAttachment[],
    opts: {
      worktree?: WorktreeSpec;
      phase: RunPhase;
      autoApprove?: boolean;
    } = { phase: 'idle' },
  ): Promise<SendPlan> {
    const plan = sendPlan(
      opts.phase,
      this.deps.hostCapabilities?.() ?? new Set(),
      staged.length > 0,
    );
    if (plan === 'direct') {
      this.sendRun(text, chat, opts);
      return 'direct';
    }
    if (plan === 'blocked') return 'blocked';

    const readBase64 = this.deps.readFileBase64;
    if (readBase64 === undefined)
      throw new Error('readFileBase64 not wired on this platform');

    if (plan === 'queue') {
      // Queue-first (ComposerView.swift queued flow): the row lands with
      // pending:// refs NOW; bytes chase it via the escort from the stash.
      const transfers = staged.map(a => ({
        uploadId: a.id,
        name: a.name,
        size: a.size,
      }));
      for (const t of transfers) {
        const b64 = await readBase64(
          staged.find(a => a.id === t.uploadId)!.localUri,
        );
        await this.deps.docDisk.saveUpload(
          this.deps.orgId,
          this.deps.userId,
          t.uploadId,
          { name: t.name, size: t.size, chatId: this.chatId },
          b64,
        );
      }
      // The host composes the withAttachments trailer from the row's
      // `attachments` at dispatch (doc_host.rs queued_message_prompt —
      // `message-queue-clean-attachment-text-v1` even strips a client-
      // expanded trailer), so `text` stays the raw user text.
      this.queueMessage(text, { attachments: pendingRefsFor(transfers) });
      this.spawnEscort(transfers);
      return 'queue';
    }

    // Legacy: upload first, block the send until every ref resolves to a
    // host path (progress rings on the strip).
    const relay = this.hostRelay();
    const paths: string[] = [];
    for (const a of staged) {
      updateAttachment(this.chatId, a.id, { uploadState: 'uploading' });
      try {
        const path = await uploadAttachmentChunked(relay, a.name, a.id, {
          readBase64: () => readBase64(a.localUri),
          clock: this.deps.clock,
          isAborted: () => this.abortedUploads.has(a.id),
          onProgress: p => updateAttachment(this.chatId, a.id, { progress: p }),
        });
        updateAttachment(this.chatId, a.id, {
          uploadState: 'uploaded',
          progress: 1,
          remoteRef: path,
        });
        paths.push(path);
      } catch (e) {
        updateAttachment(this.chatId, a.id, { uploadState: 'failed' });
        throw e;
      }
    }
    // The prompt names the paths (withAttachments transport — what persists
    // in the doc); run.attachments carries the refs only for harnesses that
    // inline image blocks.
    const body = withAttachments(text, paths);
    const harnessId = chat.config?.harness ?? '';
    this.sendRun(body, chat, {
      ...opts,
      attachments: harnessInlinesAttachments(harnessId) ? paths : undefined,
    });
    return 'legacy';
  }

  /** Abort an in-flight staged upload (composer ✕) — checked between
   * chunks and before retries; deletes only the local stash. */
  cancelUpload(attachmentId: string): void {
    this.abortedUploads.add(attachmentId);
    this.deps.docDisk
      .deleteUpload(this.deps.orgId, this.deps.userId, attachmentId)
      .catch(() => {});
  }

  /** Re-arm escorts for stashed-but-unlanded uploads on this chat
   * (respawnEscorts — called by the runtime on session open). */
  respawnEscorts(): void {
    this.deps.docDisk
      .listUploads(this.deps.orgId, this.deps.userId)
      .then(list => {
        const mine = list
          .filter(u => u.chatId === this.chatId)
          .map(u => ({ uploadId: u.uploadId, name: u.name, size: u.size }));
        if (mine.length > 0) this.spawnEscort(mine);
      })
      .catch(() => {});
  }

  private spawnEscort(
    transfers: { uploadId: string; name: string; size: number }[],
  ): void {
    new AttachmentEscort({
      orgId: this.deps.orgId,
      userId: this.deps.userId,
      docDisk: this.deps.docDisk,
      clock: this.deps.clock,
      relayFor: () => this.hostRelay(),
      nudgeHost: () => this.nudge(),
      log: this.deps.log,
    }).spawn(transfers);
  }

  private nudge(): void {
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
  }
}
