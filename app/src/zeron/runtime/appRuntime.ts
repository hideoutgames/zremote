// AppRuntime (docs/ARCHITECTURE.md "Synchronized domain state" + "Identity
// and scoping"): one instance per signed-in account {orgId, userId}. Owns the
// RegistryDoc + RegistryClient, drives workspaceStore, caches relay clients
// and SessionControllers, handles foreground/background and sign-out.

import type { DocDisk } from '../native/docDisk';
import type { LoroDocPort } from '../doc/loroPort';
import { RegistryDoc } from '../doc/registryDoc';
import { projectWorkspace } from '../doc/workspaceProjection';
import type { Clock } from '../transport/clock';
import { DeviceRelayClient } from '../transport/deviceRelayClient';
import type { EdgeConfig } from '../transport/edge';
import type { FetchImpl } from '../transport/edgeHttp';
import {
  RegistryClient,
  type RegistryEvent,
} from '../transport/registryClient';
import type { TokenSource } from '../transport/tokenSource';
import type { WsFactory } from '../transport/ws';
import {
  bindWorkspace,
  resetWorkspace,
  workspaceStore,
  type ConnectionState,
} from '../state/workspaceStore';
import { resetSessionStores } from '../state/sessionStores';
import { resetCatalog } from '../state/catalogStore';
import { bindDrafts, resetDrafts } from '../state/draftStore';
import { bindQueuedLocal, resetQueuedLocal } from '../state/queuedLocalStore';
import { bindUiPrefs, unbindUiPrefs, uiPrefsStore } from '../state/uiPrefs';
import { SessionController, type SessionMode } from './sessionController';

// WorkspaceStore.swift presence/dial-gate constants.
export const PRESENCE_TTL_MS = 30_000;
export const PRESENCE_LIVE_FRESH_MS = 45_000;
export const DIAL_GATE_DARK_MS = 5 * 60_000;
export const DIAL_GATE_WARMUP_MS = 60_000;

export type PeerLiveness = 'live' | 'dark' | 'unknown';

export interface AppRuntimeDeps {
  cfg: EdgeConfig;
  tokenSource: TokenSource;
  deviceId: string;
  deviceName: string;
  orgId: string;
  userId: string;
  wsFactory: WsFactory;
  clock: Clock;
  docDisk: DocDisk;
  loro: () => LoroDocPort;
  fetchImpl?: FetchImpl;
  /** Explicit session source: overrides the Loro probe AND the persisted
   * forceRelayMode pref (Expo Go / Settings relay toggle). */
  sessionMode?: SessionMode;
  log?: (line: string) => void;
  /** Reads a staged attachment's bytes as base64 (expo-file-system). */
  readFileBase64?: (uri: string) => Promise<string>;
}

export class AppRuntime {
  readonly registryDoc: RegistryDoc;
  get deviceId(): string {
    return this.deps.deviceId;
  }
  get cfg(): EdgeConfig {
    return this.deps.cfg;
  }
  get fetchImpl(): FetchImpl | undefined {
    return this.deps.fetchImpl;
  }
  readonly registry: RegistryClient;
  private readonly deps: AppRuntimeDeps;
  private relays = new Map<string, DeviceRelayClient>();
  private controllers = new Map<string, SessionController>();
  private presence: Record<string, number> = {};
  private connected = false;
  private registryJoinedAt: number | undefined;
  private persistTimer: unknown;
  private stopped = false;
  /** 'relay' = Loro-free host-authoritative sessions (see relaySessionSource). */
  readonly sessionMode: SessionMode;

  private constructor(
    deps: AppRuntimeDeps,
    doc: RegistryDoc,
    sessionMode: SessionMode = 'doc',
  ) {
    this.deps = deps;
    this.sessionMode = sessionMode;
    this.registryDoc = doc;
    this.registry = new RegistryClient({
      cfg: deps.cfg,
      orgId: deps.orgId,
      deviceId: deps.deviceId,
      wsFactory: deps.wsFactory,
      tokenSource: deps.tokenSource,
      clock: deps.clock,
      fetchImpl: deps.fetchImpl,
      log: deps.log,
      delegate: {
        helloCursor: () => this.registryDoc.helloCursor,
        takePushable: () => this.registryDoc.takePushable(),
        onEvent: ev => this.onRegistryEvent(ev),
      },
    });
  }

  /** Rehydrates the persisted registry doc, then builds the runtime. */
  static async create(deps: AppRuntimeDeps): Promise<AppRuntime> {
    const saved = await deps.docDisk
      .loadRegistry(deps.orgId, deps.userId)
      .catch(() => undefined);
    const doc =
      saved !== undefined
        ? safeRestore(saved, deps.deviceId)
        : new RegistryDoc(deps.deviceId);
    // Account-scoped composer drafts + UI prefs ride the same DocDisk.
    await bindDrafts(deps.docDisk, deps.orgId, deps.userId, deps.clock).catch(
      () => {},
    );
    await bindQueuedLocal(deps.docDisk, deps.orgId, deps.userId).catch(
      () => {},
    );
    await bindUiPrefs(deps.docDisk, deps.orgId, deps.userId).catch(() => {});
    // Session source selection: probe the Loro factory once — if it throws
    // (Expo Go, missing pod) every session runs in relay mode. An explicit
    // forceRelayMode pref skips the probe entirely.
    let sessionMode: SessionMode = 'doc';
    if (deps.sessionMode !== undefined) {
      sessionMode = deps.sessionMode;
    } else if (uiPrefsStore.getState().forceRelayMode) {
      sessionMode = 'relay';
    } else {
      try {
        deps.loro();
      } catch (e) {
        deps.log?.(
          `loro unavailable (${
            e instanceof Error ? e.message : String(e)
          }) — sessions run in relay mode`,
        );
        sessionMode = 'relay';
      }
    }
    return new AppRuntime(deps, doc, sessionMode);
  }

  start(): void {
    this.registry.start();
  }

  private connection(): ConnectionState {
    return this.connected ? 'connected' : 'connecting';
  }

  private onRegistryEvent(ev: RegistryEvent): void {
    const { clock } = this.deps;
    switch (ev.t) {
      case 'state':
        this.connected = true;
        this.registryJoinedAt = clock.now();
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
      case 'connected':
        this.connected = true;
        break;
      case 'disconnected':
        this.connected = false;
        this.registryDoc.markDisconnected();
        break;
    }
    bindWorkspace(
      projectWorkspace(this.registryDoc),
      this.presence,
      this.connection(),
      clock.now(),
    );
    this.schedulePersist();
  }

  private schedulePersist(): void {
    const { clock } = this.deps;
    if (this.persistTimer !== undefined) clock.clearTimeout(this.persistTimer);
    this.persistTimer = clock.setTimeout(() => {
      this.persistTimer = undefined;
      this.deps.docDisk
        .saveRegistry(
          this.deps.orgId,
          this.deps.userId,
          this.registryDoc.serialize(),
        )
        .catch(() => {});
    }, 500);
  }

  /** WorkspaceStore.swift peerLiveness: `dark` requires POSITIVE absence
   * evidence (joined, warmed-up room + freshest beat older than 5min);
   * ambiguity stays `unknown`. */
  peerLiveness(deviceId: string): PeerLiveness {
    const now = this.deps.clock.now();
    if (!this.connected || this.registryJoinedAt === undefined)
      return 'unknown';
    const received = this.presence[deviceId];
    if (received !== undefined) {
      if (now - received < PRESENCE_LIVE_FRESH_MS) return 'live';
      if (now - received >= DIAL_GATE_DARK_MS) return 'dark';
      return 'unknown';
    }
    if (now - this.registryJoinedAt < DIAL_GATE_WARMUP_MS) return 'unknown';
    const seen = this.registryDoc
      .overlayRows('devices')
      .find(
        r =>
          (typeof r.fields.id === 'string' ? r.fields.id : r.id) === deviceId,
      )?.fields.lastSeenAt;
    if (typeof seen === 'number' && now - seen >= DIAL_GATE_DARK_MS)
      return 'dark';
    return 'unknown';
  }

  relayFor(deviceId: string): DeviceRelayClient {
    let relay = this.relays.get(deviceId);
    if (relay === undefined) {
      relay = new DeviceRelayClient({
        cfg: this.deps.cfg,
        deviceId,
        wsFactory: this.deps.wsFactory,
        tokenSource: this.deps.tokenSource,
        clock: this.deps.clock,
        liveness: () => this.peerLiveness(deviceId),
        log: this.deps.log,
      });
      this.relays.set(deviceId, relay);
    }
    return relay;
  }

  private chatMeta(chatId: string) {
    return () => {
      const row = this.registryDoc.overlayRow('chats', chatId);
      const deviceId =
        typeof row?.fields.deviceId === 'string'
          ? row.fields.deviceId
          : undefined;
      const roomGen =
        typeof row?.fields.roomGen === 'number' ? row.fields.roomGen : 2;
      return { hostDeviceId: deviceId, roomGen };
    };
  }

  /** Cached controller per chat; callers `retain()`/`release()`. */
  openSession(chatId: string): SessionController {
    let c = this.controllers.get(chatId);
    if (c !== undefined && !c.isActive) {
      this.controllers.delete(chatId);
      c = undefined;
    }
    if (c === undefined) {
      const depsFor = (sessionMode: SessionMode) => ({
        ...this.deps,
        sessionMode,
        chatMeta: this.chatMeta(chatId),
        relayFor: (id: string) => {
          try {
            return this.relayFor(id);
          } catch {
            return undefined;
          }
        },
        readFileBase64: this.deps.readFileBase64,
        hostCapabilities: () => {
          const hostId = this.chatMeta(chatId)().hostDeviceId;
          const dev = workspaceStore
            .getState()
            .devices.find(d => d.id === hostId);
          return new Set(dev?.capabilities ?? []);
        },
      });
      try {
        c = new SessionController(chatId, depsFor(this.sessionMode));
      } catch (e) {
        const name = e instanceof Error ? e.name : 'Error';
        this.deps.log?.(`session construct failed (${name}) — relay`);
        c = new SessionController(chatId, depsFor('relay'));
      }
      c.start().catch(() => {});
      // Re-arm queued-attachment escorts left stashed by a prior launch
      // (SessionStore.swift respawnEscorts).
      c.respawnEscorts();
      this.controllers.set(chatId, c);
    }
    return c;
  }

  /** Only when no view holds it. */
  closeSession(chatId: string): void {
    const c = this.controllers.get(chatId);
    if (c !== undefined && c.refs <= 0) {
      c.stop();
      this.controllers.delete(chatId);
    }
  }

  onForeground(): void {
    this.registry.kick();
    for (const c of this.controllers.values()) c.kick();
  }

  onBackground(): void {
    if (this.persistTimer !== undefined) {
      this.deps.clock.clearTimeout(this.persistTimer);
      this.persistTimer = undefined;
    }
    this.deps.docDisk
      .saveRegistry(
        this.deps.orgId,
        this.deps.userId,
        this.registryDoc.serialize(),
      )
      .catch(() => {});
    for (const c of this.controllers.values()) c.flush().catch(() => {});
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.registry.stop();
    for (const c of this.controllers.values()) c.stop();
    this.controllers.clear();
    for (const r of this.relays.values()) r.close();
    this.relays.clear();
  }

  /** Sign-out / account change: wipe the on-disk account scope and reset
   * every store. */
  async clearAccountCaches(): Promise<void> {
    this.stop();
    await this.deps.docDisk.clearAccount(this.deps.orgId, this.deps.userId);
    resetWorkspace();
    resetSessionStores();
    resetCatalog();
    resetDrafts();
    resetQueuedLocal();
    unbindUiPrefs();
  }
}

const safeRestore = (data: string, deviceId: string): RegistryDoc => {
  try {
    return RegistryDoc.deserialize(data, deviceId);
  } catch {
    return new RegistryDoc(deviceId);
  }
};
