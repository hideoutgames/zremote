// Stage-3 E2E phone peer: composes the public src/zeron layers exactly the
// way SessionStore.swift / WorkspaceStore.swift do — DevAuthSession token,
// RegistryDoc + RegistryClient, DeviceRelayClient, SessionDoc over
// LoroCrdtAdapter + ChatRoomClient (first-contact full-log push, local
// updates → enqueue), nudgeHost. No protocol logic is duplicated here.

import { DevAuthSession } from '../../src/zeron/auth/authSession';
import { LoroCrdtAdapter } from '../../src/zeron/doc/loroCrdtAdapter';
import type { LoroDocPort } from '../../src/zeron/doc/loroPort';
import { RegistryDoc } from '../../src/zeron/doc/registryDoc';
import {
  SessionDoc,
  type SessionDocProjection,
} from '../../src/zeron/doc/sessionDoc';
import {
  projectWorkspace,
  type WorkspaceProjection,
} from '../../src/zeron/doc/workspaceProjection';
import type { Row } from '../../src/zeron/protocol/registryCore';
import { METHODS } from '../../src/zeron/protocol/rpc';
import type { SessionCommandPayload } from '../../src/zeron/protocol/types';
import {
  ChatRoomClient,
  type ChatRoomEvent,
} from '../../src/zeron/transport/chatRoomClient';
import { systemClock } from '../../src/zeron/transport/clock';
import { DeviceRelayClient } from '../../src/zeron/transport/deviceRelayClient';
import type { EdgeConfig } from '../../src/zeron/transport/edge';
import { nodeWsFactory } from '../../src/zeron/transport/nodeWs';
import { nudgeHost } from '../../src/zeron/transport/nudge';
import {
  RegistryClient,
  type RegistryEvent,
} from '../../src/zeron/transport/registryClient';
import type { TokenSource } from '../../src/zeron/transport/tokenSource';
import { RelaySessionSource } from '../../src/zeron/runtime/relaySessionSource';
import {
  getSessionStore,
  type SessionState,
} from '../../src/zeron/state/sessionStores';

export interface PhonePeerDeps {
  cfg: EdgeConfig;
  orgId: string;
  deviceId: string;
  userId: string;
  log?: (line: string) => void;
}

/** Persisted chat2 state for one session: Loro snapshot + server cursor
 * (SessionStore saves doc+cursor together). */
export interface PersistedSession {
  snapshotB64: string;
  cursor: number;
}

export class PhoneSession {
  readonly session: SessionDoc;
  readonly port: LoroDocPort;
  readonly room: ChatRoomClient;
  cursor = 0;
  lastEvent: ChatRoomEvent | undefined;
  private unsub: (() => void) | undefined;
  private ackWaiters: { seq: number; resolve: () => void }[] = [];

  constructor(
    private readonly phone: PhonePeer,
    readonly chatId: string,
    persisted?: PersistedSession,
  ) {
    this.port = new LoroCrdtAdapter();
    if (persisted !== undefined) {
      this.port.import(Buffer.from(persisted.snapshotB64, 'base64'));
      this.cursor = persisted.cursor;
    }
    this.session = new SessionDoc(this.port);
    this.room = new ChatRoomClient({
      cfg: phone.cfg,
      chatId,
      deviceId: phone.deviceId,
      wsFactory: nodeWsFactory,
      tokenSource: phone.tokenSource,
      clock: systemClock,
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
          return true;
        },
        applyRow: (bytes, seq) => {
          try {
            this.port.import(bytes);
          } catch {
            /* malformed row — cursor still advances (skip-not-fail) */
          }
          this.cursor = Math.max(this.cursor, seq);
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
      log: line => phone.logLine(`[chat ${chatId.slice(0, 8)}] ${line}`),
    });
  }

  private onRoomEvent(ev: ChatRoomEvent): void {
    this.lastEvent = ev;
    if (ev.t === 'pushAcked') {
      this.cursor = Math.max(this.cursor, ev.seq);
      for (const w of this.ackWaiters.splice(0)) w.resolve();
    }
  }

  /** SessionStore.start(): subscribe local updates BEFORE connecting; push
   * the whole log on first contact (cursor 0); then connect. */
  start(): void {
    this.unsub = this.port.subscribeLocalUpdates(bytes =>
      this.room.enqueue(bytes),
    );
    if (this.cursor === 0) {
      const all = this.port.exportUpdatesFrom(null);
      if (all.length > 0) this.room.enqueue(all);
    }
    this.room.start();
  }

  stop(): void {
    this.unsub?.();
    this.unsub = undefined;
    this.room.stop();
  }

  queueCommand(payload: SessionCommandPayload, basedOnTurnId?: string): string {
    return this.session.queueCommand({
      kind: payload.kind,
      payload,
      deviceId: this.phone.deviceId,
      nowMs: Date.now(),
      basedOnTurnId: basedOnTurnId ?? null,
    });
  }

  project(): SessionDocProjection | undefined {
    return this.session.project();
  }

  persist(): PersistedSession {
    return {
      snapshotB64: Buffer.from(this.port.exportSnapshot()).toString('base64'),
      cursor: this.cursor,
    };
  }

  /** Resolves when the next push ack lands (or immediately if any batch
   * has already been acked since `sinceCursor`). */
  waitForAck(afterCursor: number, timeoutMs: number): Promise<number> {
    if (this.cursor > afterCursor) return Promise.resolve(this.cursor);
    return new Promise<number>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('timed out waiting for chat2 push ack')),
        timeoutMs,
      );
      this.ackWaiters.push({
        seq: afterCursor,
        resolve: () => {
          clearTimeout(timer);
          resolve(this.cursor);
        },
      });
    });
  }
}

export class PhonePeer {
  readonly tokenSource: TokenSource;
  readonly registryDoc: RegistryDoc;
  readonly registry: RegistryClient;
  presence: Record<string, number> = {};
  lastRegistryEvent: RegistryEvent | undefined;
  private hostDeviceId: string | undefined;
  private relay: DeviceRelayClient | undefined;
  private readonly logFn: (line: string) => void;
  readonly sessions: PhoneSession[] = [];
  readonly relaySessions: RelaySessionSource[] = [];

  constructor(private readonly deps: PhonePeerDeps) {
    this.logFn = deps.log ?? (() => {});
    this.tokenSource = new DevAuthSession(deps.userId, deps.orgId);
    this.registryDoc = new RegistryDoc(deps.deviceId);
    this.registry = new RegistryClient({
      cfg: deps.cfg,
      orgId: deps.orgId,
      deviceId: deps.deviceId,
      wsFactory: nodeWsFactory,
      tokenSource: this.tokenSource,
      clock: systemClock,
      delegate: {
        helloCursor: () => this.registryDoc.helloCursor,
        takePushable: () => this.registryDoc.takePushable(),
        onEvent: ev => this.onRegistryEvent(ev),
      },
      log: line => this.logLine(`[registry] ${line}`),
    });
  }

  get cfg(): EdgeConfig {
    return this.deps.cfg;
  }
  get deviceId(): string {
    return this.deps.deviceId;
  }

  logLine(line: string): void {
    this.logFn(`phone(${this.deps.deviceId.slice(0, 12)}) ${line}`);
  }

  private onRegistryEvent(ev: RegistryEvent): void {
    this.lastRegistryEvent = ev;
    switch (ev.t) {
      case 'state':
        this.presence = { ...this.presence, ...ev.presence };
        this.registryDoc.applyState(ev.seq, ev.full, ev.gcFloor, ev.rows);
        break;
      case 'rows':
        this.registryDoc.applyRows(ev.seq, ev.rows);
        break;
      case 'ack':
        this.registryDoc.ackBatch(ev.batch, ev.seq);
        break;
      case 'presence':
        this.presence[ev.device] = ev.at;
        break;
      case 'disconnected':
        this.registryDoc.markDisconnected();
        break;
      case 'connected':
        break;
    }
  }

  start(): void {
    this.registry.start();
  }

  stop(): void {
    for (const s of this.relaySessions) s.stop();
    for (const s of this.sessions) s.stop();
    this.registry.stop();
    this.relay?.close();
  }

  workspace(): WorkspaceProjection {
    return projectWorkspace(this.registryDoc);
  }

  /** Engine relay client bound lazily to the discovered host device. */
  relayTo(hostDeviceId: string): DeviceRelayClient {
    this.hostDeviceId = hostDeviceId;
    this.relay?.close();
    this.relay = new DeviceRelayClient({
      cfg: this.deps.cfg,
      deviceId: hostDeviceId,
      wsFactory: nodeWsFactory,
      tokenSource: this.tokenSource,
      clock: systemClock,
      liveness: () => 'unknown',
      log: line => this.logLine(`[relay] ${line}`),
    });
    return this.relay;
  }

  callHost<T>(method: string, params: Record<string, unknown>): Promise<T> {
    if (this.relay === undefined)
      throw new Error('relayTo() has not been called');
    return this.relay.call<T>(method, params);
  }

  openChat(chatId: string, persisted?: PersistedSession): PhoneSession {
    const session = new PhoneSession(this, chatId, persisted);
    this.sessions.push(session);
    return session;
  }

  /** Relay-mode session (no Loro): transcript via WatchDocMessages frames,
   * queue via WatchQueue, commands via QueueCommand — the Expo Go path. */
  openRelayChat(chatId: string): {
    src: RelaySessionSource;
    state: () => SessionState;
  } {
    const src = new RelaySessionSource(chatId, {
      deviceId: this.deviceId,
      clock: systemClock,
      relayFor: () => this.relay,
      chatMeta: () => ({ hostDeviceId: this.hostDeviceId }),
      sessionRow: () => this.workspace().sessions[chatId],
      log: line => this.logLine(`[relay-session] ${line}`),
    });
    this.relaySessions.push(src);
    return { src, state: () => getSessionStore(chatId).getState() };
  }

  /** SessionStore foregrounding: enqueue a command locally (the
   * local-update subscription pushes it), then nudge the host. */
  async commandAndNudge(
    session: PhoneSession,
    payload: SessionCommandPayload,
    basedOnTurnId?: string,
  ): Promise<string> {
    const commandId = session.queueCommand(payload, basedOnTurnId);
    if (this.hostDeviceId !== undefined) {
      try {
        await nudgeHost(
          this.deps.cfg,
          this.tokenSource,
          this.hostDeviceId,
          session.chatId,
        );
      } catch {
        /* nudge is best-effort; the rows carry the command regardless */
      }
    }
    return commandId;
  }
}

export { METHODS };
export type { Row };
