// Demo mode: an in-process simulated edge + hosts. `wsFactory` answers the
// two rooms the app dials (/registry/{org}/ws as JSON text, /device/{id}/ws
// as binary-framed ControlRpc) and `fetchImpl` answers the HTTPS fallbacks.
// Every byte crosses the real client codecs — registryClient,
// DeviceRelayClient and RelaySessionSource run unchanged; nothing leaves the
// device.

import {
  applyOp,
  HlcClock,
  type Op,
  type Row,
} from '../zeron/protocol/registryCore';
import { decodeFrame, encodeFrame } from '../zeron/protocol/deviceFrames';
import { METHODS } from '../zeron/protocol/rpc';
import type { Clock } from '../zeron/transport/clock';
import type { FetchImpl, FetchResponse } from '../zeron/transport/edgeHttp';
import type { WsLike, WsMessage, WsReadyState } from '../zeron/transport/ws';
import { newId } from '../zeron/doc/sessionDoc';
import type { ContextUsage, QueuedMessage } from '../zeron/protocol/types';
import {
  CHAT_ERRORED,
  CHAT_INPUT,
  CHAT_OFFLINE,
  CHAT_WORKING,
  DEMO_ORG,
  DEMO_PHONE,
  demoAccounts,
  demoCommits,
  demoDiff,
  demoFiles,
  demoFolders,
  demoHarnesses,
  demoModels,
  demoPaths,
  demoQueues,
  demoRefs,
  demoRegistryRows,
  demoTranscripts,
  demoWorkspaceListing,
  HOST_LIVE,
} from './fixtures';
import { bytesToBase64, base64ToBytes } from '../zeron/util/base64';

const enc = new TextEncoder();
const dec = new TextDecoder();
const utf8Len = (s: string): number => enc.encode(s).length;

const RPC_FRAME_HEADER = '{"s":"rpc","k":"rpc"}';

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

// ── In-process socket ──────────────────────────────────────────────────────

class DemoWs implements WsLike {
  readyState: WsReadyState = 'CONNECTING';
  onopen: (() => void) | null = null;
  onmessage: ((m: WsMessage) => void) | null = null;
  onclose: ((e: { code: number; reason: string }) => void) | null = null;
  onerror: ((err: string) => void) | null = null;
  closed = false;

  constructor(private readonly onSend: (data: string | Uint8Array) => void) {
    // Handlers are assigned right after the factory returns — open on a
    // microtask so the client's wiring is in place (mirrors a real dial).
    Promise.resolve().then(() => {
      if (this.closed) return;
      this.readyState = 'OPEN';
      this.onopen?.();
    });
  }

  send(data: string | Uint8Array): void {
    if (this.closed || this.readyState !== 'OPEN')
      throw new Error('demo ws: send before open');
    this.onSend(data);
  }

  close(code = 1000, reason = ''): void {
    if (this.closed) return;
    this.closed = true;
    this.readyState = 'CLOSED';
    this.onclose?.({ code, reason });
  }

  /** Server → client delivery. */
  deliver(data: string | Uint8Array): void {
    if (this.closed || this.readyState !== 'OPEN') return;
    if (typeof data === 'string') this.onmessage?.({ data });
    else this.onmessage?.({ data, isBinary: true });
  }
}

interface StreamEnd {
  socket: DemoWs;
  id: number;
}

const streamItem = (end: StreamEnd, item: unknown): void => {
  end.socket.deliver(
    encodeFrame(
      RPC_FRAME_HEADER,
      enc.encode(`${JSON.stringify({ id: end.id, item })}\n`),
    ),
  );
};

const streamAck = (end: StreamEnd): void => {
  end.socket.deliver(
    encodeFrame(
      RPC_FRAME_HEADER,
      enc.encode(`${JSON.stringify({ id: end.id, ok: {} })}\n`),
    ),
  );
};

// ── Chat simulation ────────────────────────────────────────────────────────

interface RunState {
  entryId: string;
  timers: unknown[];
  /** Set when the run parked on an input request. */
  inputRequestId?: string;
}

interface ChatSim {
  chatId: string;
  deviceId: string;
  cwd: string;
  entries: Record<string, unknown>[];
  queue: QueuedMessage[];
  contextUsage: ContextUsage;
  transcriptWatchers: Set<StreamEnd>;
  queueWatchers: Set<StreamEnd>;
  run?: RunState;
  runCount: number;
}

interface Terminal {
  id: string;
  seq: number;
  line: string;
  exited: boolean;
  watchers: Set<StreamEnd>;
}

const RUN_STEP_MS = 550;

export class DemoEdge {
  private readonly clock: Clock;
  private readonly hlc = new HlcClock();
  private seq = 0;
  private readonly rows = new Map<string, Row>();
  private readonly registrySockets = new Set<DemoWs>();
  private readonly chats = new Map<string, ChatSim>();
  private readonly terminals = new Map<string, Terminal>();
  private readonly uploads = new Map<
    string,
    { chunks: string[]; name?: string }
  >();
  private presenceTimer: unknown;
  private titleSettings: Record<string, unknown> = {};
  private logins = new Map<string, { harness: string }>();

  constructor(deps: { clock: Clock }) {
    this.clock = deps.clock;
    const now = this.clock.now();
    for (const r of demoRegistryRows(now)) {
      this.rows.set(`${r.kind}:${r.id}`, r);
      this.seq = Math.max(this.seq, r.seq);
    }
    const transcripts = demoTranscripts(now);
    const queues = demoQueues(now);
    const chatDevice: Record<string, { deviceId: string; cwd: string }> = {
      [CHAT_WORKING]: { deviceId: HOST_LIVE, cwd: demoPaths.zremote },
      [CHAT_INPUT]: { deviceId: HOST_LIVE, cwd: demoPaths.zremote },
      'c-long': { deviceId: HOST_LIVE, cwd: demoPaths.zeron },
      'c-tools': { deviceId: HOST_LIVE, cwd: demoPaths.zeron },
      [CHAT_OFFLINE]: { deviceId: 'demo-studio', cwd: demoPaths.babylon },
      [CHAT_ERRORED]: { deviceId: HOST_LIVE, cwd: demoPaths.zeron },
      'c-archived': { deviceId: HOST_LIVE, cwd: demoPaths.zremote },
    };
    for (const [chatId, meta] of Object.entries(chatDevice)) {
      this.chats.set(chatId, {
        chatId,
        deviceId: meta.deviceId,
        cwd: meta.cwd,
        entries: transcripts[chatId] ?? [],
        queue: queues[chatId] ?? [],
        contextUsage: { tokens: 32_000, window: 200_000 },
        transcriptWatchers: new Set(),
        queueWatchers: new Set(),
        runCount: 0,
      });
    }
  }

  // ── Server-side registry state ──────────────────────────────────────────

  private tick(): string {
    return this.hlc.next(this.clock.now(), 'demo-edge');
  }

  /** Apply a field-set write the way a host would, then broadcast the row. */
  private hostWrite(
    kind: string,
    id: string,
    set: Record<string, unknown>,
  ): void {
    const key = `${kind}:${id}`;
    const existing = this.rows.get(key);
    const op: Op = {
      kind,
      id,
      op: existing === undefined ? 'upsert' : 'update',
      set: set as Op['set'],
      hlc: this.tick(),
    };
    const { row, changed } = applyOp(existing, op);
    if (!changed || row === undefined) return;
    this.seq += 1;
    row.seq = this.seq;
    this.rows.set(key, row);
    this.broadcastRows([row]);
  }

  private broadcastRows(rows: Row[]): void {
    if (rows.length === 0) return;
    const frame = JSON.stringify({ t: 'rows', seq: this.seq, rows });
    for (const socket of this.registrySockets) socket.deliver(frame);
  }

  private setSessionStatus(chatId: string, status: string): void {
    const chat = this.chats.get(chatId);
    if (chat === undefined) return;
    this.hostWrite('sessions', chatId, {
      chatId,
      deviceId: chat.deviceId,
      status,
      updatedAt: this.clock.now(),
    });
  }

  // ── wsFactory ───────────────────────────────────────────────────────────

  readonly wsFactory = (url: string): WsLike => {
    if (url.includes('/registry/')) return this.openRegistrySocket();
    if (url.includes('/device/')) return this.openDeviceSocket(url);
    // Unknown room: a socket that never opens mirrors a dead route without
    // inventing errors — the client's dial deadline handles it.
    return new DemoWs(() => {});
  };

  private openRegistrySocket(): DemoWs {
    const socket = new DemoWs(data => {
      if (typeof data !== 'string') return;
      if (data === 'ping') {
        socket.deliver('pong');
        return;
      }
      let frame: Record<string, unknown>;
      try {
        frame = JSON.parse(data) as Record<string, unknown>;
      } catch {
        return;
      }
      this.onRegistryFrame(socket, frame);
    });
    this.registrySockets.add(socket);
    const beat = () => {
      if (socket.closed) return;
      socket.deliver(
        JSON.stringify({
          t: 'presence',
          device: HOST_LIVE,
          at: this.clock.now(),
        }),
      );
      this.presenceTimer = this.clock.setTimeout(beat, 10_000);
    };
    this.presenceTimer = this.clock.setTimeout(beat, 10_000);
    const origClose = socket.close.bind(socket);
    socket.close = (code?: number, reason?: string) => {
      this.registrySockets.delete(socket);
      if (this.presenceTimer !== undefined) {
        this.clock.clearTimeout(this.presenceTimer);
        this.presenceTimer = undefined;
      }
      origClose(code, reason);
    };
    return socket;
  }

  private onRegistryFrame(
    socket: DemoWs,
    frame: Record<string, unknown>,
  ): void {
    switch (frame.t) {
      case 'hello': {
        const presence: Record<string, number> = {
          [HOST_LIVE]: this.clock.now(),
        };
        socket.deliver(
          JSON.stringify({
            t: 'state',
            seq: this.seq,
            full: true,
            gcFloor: 0,
            rows: [...this.rows.values()],
            presence,
          }),
        );
        return;
      }
      case 'push': {
        const ops = Array.isArray(frame.ops) ? (frame.ops as Op[]) : [];
        const changed: Row[] = [];
        for (const op of ops) {
          const key = `${op.kind}:${op.id}`;
          const { row, changed: didChange } = applyOp(this.rows.get(key), op);
          if (didChange && row !== undefined) {
            this.seq += 1;
            row.seq = this.seq;
            this.rows.set(key, row);
            changed.push(row);
          }
        }
        socket.deliver(
          JSON.stringify({
            t: 'ack',
            batch: frame.batch,
            seq: this.seq,
            applied: changed.length,
          }),
        );
        this.broadcastRows(changed);
        return;
      }
      case 'presence':
        return; // phone's own beat — recorded implicitly
      case 'probe':
        socket.deliver(JSON.stringify({ t: 'probe-ok', seq: this.seq }));
        return;
      default:
        socket.deliver(
          JSON.stringify({ t: 'error', code: 'bad-frame', message: 'demo' }),
        );
    }
  }

  // ── Device room ─────────────────────────────────────────────────────────

  private openDeviceSocket(url: string): DemoWs {
    const match = /\/device\/([^/]+)\/ws/.exec(url);
    const deviceId = match?.[1] ?? '';
    // Dark hosts never answer a dial: the socket just never opens, which is
    // exactly what a powered-off peer looks like to the relay client.
    if (deviceId !== HOST_LIVE) return new DemoWs(() => {});

    const streams = new Map<number, () => void>();
    const socket = new DemoWs(data => {
      if (typeof data === 'string') {
        if (data === 'ping') socket.deliver('pong');
        return;
      }
      const frame = decodeFrame(data);
      if (frame === undefined) return;
      if (frame.header.k === 'echo') {
        socket.deliver(data); // echo frames bounce verbatim
        return;
      }
      if (frame.header.k !== 'rpc') return;
      for (const line of dec.decode(frame.payload).split('\n')) {
        if (line.length === 0) continue;
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(line) as Record<string, unknown>;
        } catch {
          continue;
        }
        const id = typeof msg.id === 'number' ? msg.id : undefined;
        if (id === undefined) continue;
        if (msg.cancel === true) {
          streams.get(id)?.();
          streams.delete(id);
          continue;
        }
        const method = typeof msg.method === 'string' ? msg.method : '';
        this.dispatch(socket, streams, id, method, msg.params);
      }
    });
    const origClose = socket.close.bind(socket);
    socket.close = (code?: number, reason?: string) => {
      for (const cleanup of streams.values()) cleanup();
      streams.clear();
      origClose(code, reason);
    };
    return socket;
  }

  private reply(socket: DemoWs, id: number, ok: unknown): void {
    socket.deliver(
      encodeFrame(
        RPC_FRAME_HEADER,
        enc.encode(`${JSON.stringify({ id, ok })}\n`),
      ),
    );
  }

  private replyErr(socket: DemoWs, id: number, err: string): void {
    socket.deliver(
      encodeFrame(
        RPC_FRAME_HEADER,
        enc.encode(`${JSON.stringify({ id, err })}\n`),
      ),
    );
  }

  private chat(chatId: unknown): ChatSim | undefined {
    return typeof chatId === 'string' ? this.chats.get(chatId) : undefined;
  }

  // ── RPC dispatch ────────────────────────────────────────────────────────

  private dispatch(
    socket: DemoWs,
    streams: Map<number, () => void>,
    id: number,
    method: string,
    params: unknown,
  ): void {
    const p = isObj(params) ? params : {};
    const end: StreamEnd = { socket, id };
    switch (method) {
      // ── Catalog / device config ──
      case METHODS.LIST_HARNESSES:
        return this.reply(socket, id, demoHarnesses());
      case METHODS.SET_HARNESS_ENABLED:
        return this.reply(socket, id, demoHarnesses());
      case METHODS.LIST_MODELS:
        return this.reply(
          socket,
          id,
          demoModels(typeof p.harness === 'string' ? p.harness : undefined),
        );
      case METHODS.LIST_COMMANDS:
        return this.reply(socket, id, { commands: [] });
      case METHODS.GET_TITLE_SETTINGS:
        return this.reply(socket, id, this.titleSettings);
      case METHODS.SET_TITLE_SETTINGS:
        this.titleSettings = { ...p };
        return this.reply(socket, id, {});
      case METHODS.LIST_FOLDERS:
        return this.reply(
          socket,
          id,
          demoFolders(typeof p.path === 'string' ? p.path : undefined),
        );
      case METHODS.LIST_DRIVES:
        return this.reply(socket, id, { drives: [{ path: '/demo' }] });
      case METHODS.LIST_REFS:
        return this.reply(socket, id, demoRefs());
      case METHODS.SWITCH_REF:
        return this.reply(socket, id, {
          branch: typeof p.refName === 'string' ? p.refName : 'main',
        });
      case METHODS.CREATE_WORKTREE:
        return this.reply(socket, id, { path: '/demo/zremote-wt' });
      case METHODS.DELETE_WORKTREE:
      case METHODS.FETCH_ALL:
        return this.reply(socket, id, {});
      case METHODS.LIST_REPOS:
        return this.reply(socket, id, { repos: [] });
      case METHODS.LIST_BRANCHES:
        return this.reply(socket, id, {
          branches: demoRefs().map(r => r.name),
        });
      case METHODS.ADD_REPO:
      case METHODS.CLONE_REPO:
      case METHODS.CREATE_REPO:
        return this.reply(socket, id, {});
      case METHODS.SEARCH_FILES:
        return this.reply(socket, id, { matches: [] });

      // ── Mutate (host-side workspace writes) ──
      case METHODS.MUTATE:
        return this.mutate(socket, id, p);

      // ── Session transcript + queue ──
      case METHODS.WATCH_DOC_MESSAGES:
        return this.watchTranscript(end, streams, p);
      case METHODS.WATCH_QUEUE:
        return this.watchQueue(end, streams, p);
      case METHODS.QUEUE_COMMAND:
        return this.queueCommand(socket, id, p);
      case METHODS.RELAY_COMMAND:
        return this.queueCommand(socket, id, p);
      case METHODS.RETRY_DELIVERY:
        return this.reply(socket, id, {});
      case METHODS.QUEUE_MESSAGE:
        return this.queueMessage(socket, id, p);
      case METHODS.UPDATE_QUEUED_MESSAGE:
        return this.updateQueued(socket, id, p);
      case METHODS.REMOVE_QUEUED_MESSAGE:
        return this.removeQueued(socket, id, p);
      case METHODS.SEND_QUEUED_MESSAGE_NOW:
        return this.sendQueuedNow(socket, id, p);
      case METHODS.STEER_QUEUED_MESSAGE_NOW:
        return this.steerQueuedNow(socket, id, p);
      case METHODS.MOVE_QUEUED_MESSAGE:
        return this.moveQueued(socket, id, p);
      case METHODS.BEGIN_QUEUED_MESSAGE_EDIT:
        return this.reply(socket, id, {
          leaseId: `demo-lease-${newId()}`,
          expiresAtMs: this.clock.now() + 30_000,
        });
      case METHODS.RENEW_QUEUED_MESSAGE_EDIT:
        return this.reply(socket, id, {
          expiresAtMs: this.clock.now() + 30_000,
        });
      case METHODS.FINISH_QUEUED_MESSAGE_EDIT:
        return this.reply(socket, id, {});

      // ── Attachments ──
      case METHODS.UPLOAD_CHUNK:
        return this.uploadChunk(socket, id, p);
      case METHODS.UPLOAD_COMMIT:
        return this.uploadCommit(socket, id, p);
      case METHODS.READ_ATTACHMENT_CHUNK:
        return this.reply(socket, id, {
          data: TINY_PNG_B64,
          nextOffset: TINY_PNG_B64.length,
          done: true,
        });
      case METHODS.FETCH_TOOL_BLOB:
        return this.replyErr(socket, id, 'demo: no tool blobs');

      // ── Workspace files ──
      case METHODS.LIST_WORKSPACE_DIRECTORY:
        return this.reply(socket, id, {
          directory: typeof p.directory === 'string' ? p.directory : '',
          entries: demoWorkspaceListing(
            typeof p.directory === 'string' ? p.directory : '',
          ),
          truncated: false,
        });
      case METHODS.SEARCH_WORKSPACE_FILES: {
        const q = typeof p.query === 'string' ? p.query.toLowerCase() : '';
        const matches = Object.keys(demoFiles)
          .filter(f => q !== '' && f.toLowerCase().includes(q))
          .map(f => ({
            path: f,
            name: f.split('/').pop() ?? f,
            kind: 'file' as const,
            score: 1,
          }));
        return this.reply(socket, id, matches);
      }
      case METHODS.READ_WORKSPACE_FILE: {
        const path = typeof p.path === 'string' ? p.path : '';
        const text = demoFiles[path];
        if (text === undefined)
          return this.replyErr(socket, id, `demo: no such file ${path}`);
        return this.reply(socket, id, {
          checkoutId: 'demo-checkout',
          path,
          text,
          contentHash: `demo-${utf8Len(text)}`,
          size: utf8Len(text),
          encoding: 'utf8',
          lineEnding: 'lf',
          truncated: false,
        });
      }
      case METHODS.WRITE_WORKSPACE_FILE: {
        const path = typeof p.path === 'string' ? p.path : '';
        const text = typeof p.text === 'string' ? p.text : '';
        demoFiles[path] = text;
        return this.reply(socket, id, {
          status: 'written',
          file: {
            path,
            contentHash: `demo-${utf8Len(text)}`,
            size: utf8Len(text),
            modifiedAt: '2026-09-19T10:00:00Z',
          },
        });
      }
      case METHODS.READ_WORKSPACE_IMAGE:
        return this.reply(socket, id, {
          checkoutId: 'demo-checkout',
          contentHash: 'demo-img',
          mimeType: 'image/png',
          data: TINY_PNG_B64,
          nextOffset: TINY_PNG_B64.length,
          size: TINY_PNG_B64.length,
          done: true,
        });
      case METHODS.WATCH_WORKSPACE_FILES:
        streamItem(end, { sequence: 1, resyncRequired: false, changes: [] });
        streams.set(id, () => {});
        return;

      // ── Checkout diffs ──
      case METHODS.WATCH_CHECKOUT_DIFFS:
        streamItem(end, [
          demoDiff('demo-checkout', HOST_LIVE, demoPaths.zremote),
        ]);
        streams.set(id, () => {});
        return;
      case METHODS.GET_CHECKOUT_DIFF:
        return this.reply(
          socket,
          id,
          demoDiff('demo-checkout', HOST_LIVE, demoPaths.zremote),
        );
      case METHODS.GET_CHECKOUT_FILE_DIFF_TEXT:
        return this.reply(socket, id, {
          diffChecksum: 'demo-checksum-1',
          newText: demoFiles[typeof p.path === 'string' ? p.path : ''] ?? '',
          binary: false,
          truncated: false,
          stale: false,
        });
      case METHODS.WATCH_CHECKOUT_CHANGE_REQUEST:
        streamItem(end, {
          checkoutId: 'demo-checkout',
          deviceId: HOST_LIVE,
          cwd: demoPaths.zremote,
          branch: typeof p.branch === 'string' ? p.branch : 'main',
          changeRequest: {
            provider: 'github',
            number: 42,
            title: 'Composer chrome overhaul',
            url: 'https://github.com/example/zremote/pull/42',
            state: 'open',
            draft: true,
            baseRef: 'main',
            headRef: 'feature/composer',
            body: '## Summary\n\nDemo pull request for the composer chrome.',
          },
          updatedAt: '2026-09-19T10:00:00Z',
        });
        streams.set(id, () => {});
        return;

      // ── Git history ──
      case METHODS.LIST_GIT_HISTORY:
        return this.reply(socket, id, {
          commits: demoCommits(),
          branchTips: [demoCommits()[0]],
          headSha: 'aaa001',
          totalCount: demoCommits().length,
        });
      case METHODS.SEARCH_GIT_HISTORY: {
        const q = typeof p.query === 'string' ? p.query.toLowerCase() : '';
        return this.reply(socket, id, {
          commits: demoCommits().filter(
            c => c.subject.toLowerCase().includes(q) || c.sha.startsWith(q),
          ),
          branchTips: [],
        });
      }
      case METHODS.RESOLVE_GIT_AVATARS:
        return this.reply(socket, id, {});

      // ── Terminals ──
      case METHODS.OPEN_TERMINAL: {
        const termId = `term-${newId()}`;
        this.terminals.set(termId, {
          id: termId,
          seq: 0,
          line: '',
          exited: false,
          watchers: new Set(),
        });
        return this.reply(socket, id, {
          id: termId,
          cwd: demoPaths.zremote,
          shell: '/bin/zsh',
        });
      }
      case METHODS.SUBSCRIBE_TERMINAL:
        return this.subscribeTerminal(end, streams, p);
      case METHODS.WRITE_TERMINAL:
        return this.writeTerminal(socket, id, p);
      case METHODS.RESIZE_TERMINAL:
        return this.reply(socket, id, {});
      case METHODS.CLOSE_TERMINAL:
        return this.closeTerminal(socket, id, p);

      // ── Agent accounts ──
      case METHODS.LIST_AGENT_ACCOUNTS:
        return this.reply(socket, id, demoAccounts());
      case METHODS.ACTIVATE_AGENT_ACCOUNT:
        return this.reply(socket, id, demoAccounts());
      case METHODS.FORGET_AGENT_ACCOUNT:
        return this.reply(socket, id, {
          accounts: [],
          warnings: [],
        });
      case METHODS.START_AGENT_LOGIN: {
        const loginId = `demo-login-${newId()}`;
        this.logins.set(loginId, {
          harness: typeof p.harness === 'string' ? p.harness : 'claude',
        });
        return this.reply(socket, id, {
          loginId,
          url: '',
          mode: 'paste-code',
        });
      }
      case METHODS.POLL_AGENT_LOGIN:
        return this.reply(socket, id, { status: 'pending' });
      case METHODS.COMPLETE_AGENT_LOGIN:
        return this.reply(socket, id, demoAccounts());
      case METHODS.CANCEL_AGENT_LOGIN:
        return this.reply(socket, id, {});

      // ── Previews / updates / introspection ──
      case METHODS.WATCH_PREVIEWS:
        streamItem(end, { services: [], proxyPort: 0 });
        streams.set(id, () => {});
        return;
      case METHODS.UPDATE_STATUS:
        streamItem(end, {
          currentVersion: '0.2.72',
          updateAvailable: false,
          checkedAt: this.clock.now(),
        });
        streams.set(id, () => {});
        return;
      case METHODS.APPLY_UPDATE:
        return this.reply(socket, id, {});
      case METHODS.PROBE_SYNC:
        return this.reply(socket, id, {});
      case METHODS.SYNC_STATUS:
        return this.reply(socket, id, { rooms: [] });
      case METHODS.WATCH_CHATS:
      case METHODS.WATCH_DEVICES:
      case METHODS.WATCH_SESSIONS:
      case METHODS.WATCH_SPACES:
      case METHODS.WATCH_CONNECTIVITY:
      case METHODS.WATCH_TRANSFERS:
        // Streams the app never opens; ack readiness and hold them open so
        // a hypothetical subscriber isn't churned by resubscribe loops.
        streamAck(end);
        streams.set(id, () => {});
        return;
      case METHODS.LOCAL_DEVICE:
        return this.reply(socket, id, { deviceId: HOST_LIVE });
      case METHODS.ENGINE_INFO:
        return this.reply(socket, id, {
          deviceId: HOST_LIVE,
          orgId: DEMO_ORG,
          version: '0.2.72',
        });
      case METHODS.ENGINE_READY:
        return this.reply(socket, id, { ready: true });
      case METHODS.STOP_ENGINE:
        return this.reply(socket, id, {});
      case METHODS.AUTH_STATUS:
      case METHODS.SIGN_IN:
      case METHODS.SIGN_IN_HEADLESS:
      case METHODS.COMPLETE_SIGN_IN:
      case METHODS.SIGN_OUT:
      case METHODS.LIST_ORGS:
      case METHODS.CREATE_ORG:
      case METHODS.SELECT_ORG:
      case METHODS.LOCAL_IMPORT_STATUS:
      case METHODS.IMPORT_LOCAL_WORKSPACE:
        return this.replyErr(socket, id, 'demo: auth runs off-device');
      default:
        return this.replyErr(socket, id, `demo: unknown method ${method}`);
    }
  }

  // ── Mutate ────────────────────────────────────────────────────────────────

  private mutate(socket: DemoWs, id: number, p: Record<string, unknown>): void {
    switch (p.op) {
      case 'createSpace': {
        const spaceId = typeof p.spaceId === 'string' ? p.spaceId : newId();
        this.hostWrite('spaces', spaceId, {
          id: spaceId,
          deviceId: typeof p.deviceId === 'string' ? p.deviceId : HOST_LIVE,
          path: typeof p.path === 'string' ? p.path : '/demo/new-space',
          ...(typeof p.name === 'string' ? { name: p.name } : {}),
          gitDetected: p.gitDetected === true,
          createdAt: this.clock.now(),
        });
        return this.reply(socket, id, { spaceId });
      }
      case 'renameDevice': {
        const deviceId = typeof p.deviceId === 'string' ? p.deviceId : '';
        if (typeof p.name === 'string')
          this.hostWrite('devices', deviceId, { name: p.name });
        return this.reply(socket, id, {});
      }
      default:
        return this.reply(socket, id, {});
    }
  }

  // ── Transcript stream ─────────────────────────────────────────────────────

  private watchTranscript(
    end: StreamEnd,
    streams: Map<number, () => void>,
    p: Record<string, unknown>,
  ): void {
    const chat = this.chat(p.chatId);
    if (chat === undefined) {
      end.socket.deliver(
        encodeFrame(
          RPC_FRAME_HEADER,
          enc.encode(
            `${JSON.stringify({ id: end.id, err: 'demo: unknown chat' })}\n`,
          ),
        ),
      );
      return;
    }
    chat.transcriptWatchers.add(end);
    streams.set(end.id, () => chat.transcriptWatchers.delete(end));
    const reset = {
      reset: chat.entries,
      contextUsage: chat.contextUsage,
    };
    this.transcriptFrames.push(JSON.parse(JSON.stringify(reset)));
    streamItem(end, reset);
    // A chat whose row says `working` resumes streaming on first watch.
    if (
      chat.run === undefined &&
      this.sessionStatus(chat.chatId) === 'working'
    ) {
      this.resumeWorking(chat);
    }
  }

  private sessionStatus(chatId: string): string | undefined {
    const row = this.rows.get(`sessions:${chatId}`);
    const s = row?.fields.status;
    return typeof s === 'string' ? s : undefined;
  }

  private anchorOf(chat: ChatSim, entryId: string): string | null {
    const ix = chat.entries.findIndex(e => e.id === entryId);
    if (ix <= 0) return null;
    return String(chat.entries[ix - 1].id);
  }

  private lastEntryId(chat: ChatSim): string | null {
    const tail = chat.entries[chat.entries.length - 1];
    return tail === undefined ? null : String(tail.id);
  }

  /** Every transcript frame emitted (test hook — lets Jest replay frames
   * through applyTranscriptFrame without standing up a socket). */
  public readonly transcriptFrames: Record<string, unknown>[] = [];

  private emit(chat: ChatSim, frame: Record<string, unknown>): void {
    const payload = {
      upsert: [],
      append: [],
      remove: [],
      count: chat.entries.length,
      ...frame,
    };
    // Snapshot: entries/parts are mutated by later steps — the watcher would
    // otherwise record frames as they look at the END of the run.
    this.transcriptFrames.push(JSON.parse(JSON.stringify(payload)));
    for (const end of chat.transcriptWatchers) {
      streamItem(end, payload);
    }
  }

  private emitQueue(chat: ChatSim): void {
    for (const end of chat.queueWatchers) {
      streamItem(end, { items: chat.queue });
    }
  }

  private upsertEntry(chat: ChatSim, entry: Record<string, unknown>): void {
    const ix = chat.entries.findIndex(e => e.id === entry.id);
    const after =
      ix >= 0
        ? this.anchorOf(chat, entry.id as string)
        : this.lastEntryId(chat);
    if (ix >= 0) chat.entries[ix] = entry;
    else chat.entries.push(entry);
    this.emit(chat, { upsert: [{ after, entry }] });
  }

  private appendText(
    chat: ChatSim,
    entryId: string,
    partId: string,
    chunk: string,
  ): void {
    const entry = chat.entries.find(e => e.id === entryId);
    const parts = (entry?.parts ?? []) as Record<string, unknown>[];
    const part = parts.find(pp => pp.id === partId);
    if (part === undefined) return;
    const field = part.kind === 'reasoning' ? 'reasoning' : 'text';
    const next = `${(part[field] as string | undefined) ?? ''}${chunk}`;
    part[field] = next;
    this.emit(chat, {
      append: [
        { entry: entryId, part: partId, text: chunk, len: utf8Len(next) },
      ],
    });
  }

  private watchQueue(
    end: StreamEnd,
    streams: Map<number, () => void>,
    p: Record<string, unknown>,
  ): void {
    const chat = this.chat(p.chatId);
    if (chat === undefined) return streamAck(end);
    chat.queueWatchers.add(end);
    streams.set(end.id, () => chat.queueWatchers.delete(end));
    streamItem(end, { items: chat.queue });
  }

  // ── Command plane (the simulated run) ─────────────────────────────────────

  private queueCommand(
    socket: DemoWs,
    id: number,
    p: Record<string, unknown>,
  ): void {
    const chat = this.chat(p.chatId);
    const command = isObj(p.command) ? p.command : {};
    if (chat === undefined)
      return this.replyErr(socket, id, 'demo: unknown chat');
    switch (command.kind) {
      case 'run': {
        const request = isObj(command.request) ? command.request : {};
        const prompt = typeof request.prompt === 'string' ? request.prompt : '';
        const messageId =
          typeof command.messageId === 'string' ? command.messageId : newId();
        this.reply(socket, id, { commandId: newId() });
        this.startRun(chat, prompt, messageId);
        return;
      }
      case 'steer': {
        const prompt = typeof command.prompt === 'string' ? command.prompt : '';
        this.reply(socket, id, { commandId: newId() });
        this.injectSteer(chat, prompt);
        return;
      }
      case 'interrupt': {
        this.reply(socket, id, { commandId: newId() });
        this.interrupt(chat);
        return;
      }
      case 'respondInput': {
        this.reply(socket, id, { commandId: newId() });
        this.respondInput(
          chat,
          typeof command.requestId === 'string' ? command.requestId : '',
        );
        return;
      }
      default:
        return this.replyErr(socket, id, 'demo: unknown command kind');
    }
  }

  private startRun(chat: ChatSim, prompt: string, messageId: string): void {
    this.cancelRunTimers(chat);
    const now = this.clock.now();
    const userEntry = {
      id: messageId,
      role: 'user',
      parts: [{ kind: 'text', id: `${messageId}-t`, text: prompt }],
      createdAt: now,
      deviceId: DEMO_PHONE,
    };
    this.upsertEntry(chat, userEntry);
    const entryId = `demo-a-${newId()}`;
    const rPart = `${entryId}-r`;
    const tPart = `${entryId}-t`;
    const tool1 = `${entryId}-tool1`;
    const tool2 = `${entryId}-tool2`;
    const inputId = `${entryId}-input`;
    chat.runCount += 1;
    chat.run = { entryId, timers: [] };
    this.setSessionStatus(chat.chatId, 'working');
    this.hostWrite('chats', chat.chatId, {
      lastMessagePreview: prompt.slice(0, 80),
      lastMessageAt: now,
    });

    const steps: [number, () => void][] = [
      [
        1,
        () =>
          this.upsertEntry(chat, {
            id: entryId,
            role: 'assistant',
            parts: [{ kind: 'reasoning', id: rPart, reasoning: '' }],
            createdAt: this.clock.now(),
            deviceId: HOST_LIVE,
            status: 'streaming',
          }),
      ],
      [
        2,
        () =>
          this.appendText(
            chat,
            entryId,
            rPart,
            'Let me look at the relevant code first.',
          ),
      ],
      [
        3,
        () => {
          const entry = chat.entries.find(e => e.id === entryId);
          if (entry === undefined) return;
          (entry.parts as Record<string, unknown>[]).push({
            kind: 'text',
            id: tPart,
            text: '',
          });
          this.upsertEntry(chat, entry);
        },
      ],
      [
        4,
        () =>
          this.appendText(
            chat,
            entryId,
            tPart,
            '## Plan\n\nHere is what I found:\n\n- the room client is already correct\n- only the retry cap needs a bump\n- `keepaliveTick` covers the rest\n\n',
          ),
      ],
      [
        5,
        () =>
          this.appendText(
            chat,
            entryId,
            tPart,
            'The change is small — see `SILENCE_LEASE_MS`:\n\n```ts\nif (now - last > LEASE) teardown();\n```\n\n',
          ),
      ],
      [
        6,
        () => {
          const entry = chat.entries.find(e => e.id === entryId);
          if (entry === undefined) return;
          (entry.parts as Record<string, unknown>[]).push({
            kind: 'tool',
            id: tool1,
            call: { kind: 'readFile', path: '/demo/src/relay.ts' },
          });
          this.upsertEntry(chat, entry);
        },
      ],
      [
        7,
        () => {
          const entry = chat.entries.find(e => e.id === entryId);
          if (entry === undefined) return;
          const parts = entry.parts as Record<string, unknown>[];
          const t1 = parts.find(pp => pp.id === tool1);
          if (t1 !== undefined) {
            t1.isError = false;
            t1.output = 'read 42 lines';
          }
          parts.push({
            kind: 'tool',
            id: tool2,
            call: { kind: 'editFile', path: '/demo/src/relay.ts' },
          });
          this.upsertEntry(chat, entry);
        },
      ],
      [
        8,
        () => {
          const entry = chat.entries.find(e => e.id === entryId);
          if (entry === undefined) return;
          const t2 = (entry.parts as Record<string, unknown>[]).find(
            pp => pp.id === tool2,
          );
          if (t2 !== undefined) {
            t2.isError = false;
            t2.output = 'applied 1 edit';
            t2.diff = {
              path: 'src/relay.ts',
              oldText: 'const CAP = 8_000;',
              newText: 'const CAP = 16_000;',
            };
            t2.diffStats = [
              { path: 'src/relay.ts', additions: 1, deletions: 1 },
            ];
          }
          this.upsertEntry(chat, entry);
        },
      ],
      [
        9,
        () => {
          if (chat.runCount % 3 === 0) {
            const entry = chat.entries.find(e => e.id === entryId);
            if (entry !== undefined) {
              (entry.parts as Record<string, unknown>[]).push({
                kind: 'input',
                id: inputId,
                requestId: inputId,
                questions: [
                  {
                    id: 'q1',
                    header: 'Direction',
                    question: 'Which approach should I take?',
                    options: [
                      'Minimal patch',
                      'Refactor the client',
                      'Add a feature flag',
                    ],
                  },
                ],
                resolved: false,
              });
              this.upsertEntry(chat, entry);
            }
            if (chat.run !== undefined) chat.run.inputRequestId = inputId;
            this.setSessionStatus(chat.chatId, 'awaitingInput');
            return;
          }
          this.finishRun(chat, entryId);
        },
      ],
    ];
    for (const [step, fn] of steps) {
      chat.run.timers.push(
        this.clock.setTimeout(() => {
          if (chat.run?.entryId !== entryId) return;
          fn();
        }, step * RUN_STEP_MS),
      );
    }
  }

  private finishRun(chat: ChatSim, entryId: string): void {
    const entry = chat.entries.find(e => e.id === entryId);
    if (entry !== undefined) {
      entry.status = 'complete';
      this.upsertEntry(chat, entry);
    }
    chat.contextUsage = { tokens: 41_000, window: 200_000 };
    this.emit(chat, { contextUsage: chat.contextUsage });
    this.setSessionStatus(chat.chatId, 'idle');
    if (chat.run !== undefined) chat.run = undefined;
  }

  /** Continuation for a fixture chat already mid-stream when opened. */
  private resumeWorking(chat: ChatSim): void {
    const entry = [...chat.entries]
      .reverse()
      .find(e => e.status === 'streaming');
    if (entry === undefined) {
      this.setSessionStatus(chat.chatId, 'idle');
      return;
    }
    const entryId = String(entry.id);
    const textPart = (entry.parts as Record<string, unknown>[]).find(
      pp => pp.kind === 'text',
    );
    chat.run = { entryId, timers: [] };
    const timers = chat.run.timers;
    if (textPart !== undefined) {
      const pid = String(textPart.id);
      timers.push(
        this.clock.setTimeout(
          () =>
            this.appendText(
              chat,
              entryId,
              pid,
              ' — then the queue and workspace files.',
            ),
          800,
        ),
      );
      timers.push(
        this.clock.setTimeout(
          () =>
            this.appendText(
              chat,
              entryId,
              pid,
              '\n\nAll seams verified. Demo edge is live.',
            ),
          1600,
        ),
      );
    }
    timers.push(
      this.clock.setTimeout(() => this.finishRun(chat, entryId), 2400),
    );
  }

  private injectSteer(chat: ChatSim, prompt: string): void {
    const run = chat.run;
    if (run === undefined) return;
    const entry = chat.entries.find(e => e.id === run.entryId);
    if (entry === undefined) return;
    (entry.parts as Record<string, unknown>[]).push({
      kind: 'text',
      id: `${run.entryId}-steer-${newId()}`,
      text: `Adjusting: ${prompt}`,
    });
    this.upsertEntry(chat, entry);
  }

  private interrupt(chat: ChatSim): void {
    const run = chat.run;
    if (run !== undefined) {
      for (const t of run.timers) this.clock.clearTimeout(t);
      const entry = chat.entries.find(e => e.id === run.entryId);
      if (entry !== undefined) {
        entry.status = 'aborted';
        this.upsertEntry(chat, entry);
      }
      chat.run = undefined;
    }
    this.setSessionStatus(chat.chatId, 'idle');
  }

  private respondInput(chat: ChatSim, requestId: string): void {
    const entry = chat.entries.find(e =>
      (e.parts as Record<string, unknown>[]).some(
        pp => pp.kind === 'input' && pp.id === requestId,
      ),
    );
    if (entry === undefined) return;
    for (const part of entry.parts as Record<string, unknown>[]) {
      if (part.kind === 'input' && part.id === requestId) part.resolved = true;
    }
    this.upsertEntry(chat, entry);
    if (chat.run?.inputRequestId === requestId) {
      // The parked run finishes once its question is answered.
      this.clock.setTimeout(
        () => this.finishRun(chat, chat.run?.entryId ?? ''),
        RUN_STEP_MS,
      );
    } else {
      entry.status = 'complete';
      this.upsertEntry(chat, entry);
      this.setSessionStatus(chat.chatId, 'idle');
    }
  }

  private cancelRunTimers(chat: ChatSim): void {
    if (chat.run === undefined) return;
    for (const t of chat.run.timers) this.clock.clearTimeout(t);
    chat.run = undefined;
  }

  // ── Queue mutations ──────────────────────────────────────────────────────

  private queueMessage(
    socket: DemoWs,
    id: number,
    p: Record<string, unknown>,
  ): void {
    const chat = this.chat(p.chatId);
    const text = typeof p.text === 'string' ? p.text : '';
    const qid = newId();
    if (chat !== undefined && text.trim() !== '') {
      chat.queue.push({
        id: qid,
        text,
        ...(Array.isArray(p.attachments) && p.attachments.length > 0
          ? { attachments: p.attachments.map(String) }
          : {}),
        ...(p.holdForTurnEnd === true ? { holdForTurnEnd: true } : {}),
        issuedBy: DEMO_PHONE,
        issuedAt: this.clock.now(),
      });
      this.emitQueue(chat);
    }
    return this.reply(socket, id, { id: qid });
  }

  private updateQueued(
    socket: DemoWs,
    id: number,
    p: Record<string, unknown>,
  ): void {
    const chat = this.chat(p.chatId);
    if (chat === undefined) return this.reply(socket, id, { changed: false });
    const ix = chat.queue.findIndex(q => q.id === p.id);
    if (ix < 0) return this.reply(socket, id, { changed: false });
    const text = typeof p.text === 'string' ? p.text : '';
    if (text.trim() === '') chat.queue.splice(ix, 1);
    else
      chat.queue[ix] = { ...chat.queue[ix], text, editedAt: this.clock.now() };
    this.emitQueue(chat);
    return this.reply(socket, id, { changed: true });
  }

  private removeQueued(
    socket: DemoWs,
    id: number,
    p: Record<string, unknown>,
  ): void {
    const chat = this.chat(p.chatId);
    const ix = chat?.queue.findIndex(q => q.id === p.id) ?? -1;
    if (chat !== undefined && ix >= 0) {
      chat.queue.splice(ix, 1);
      this.emitQueue(chat);
      return this.reply(socket, id, { removed: true });
    }
    return this.reply(socket, id, { removed: false });
  }

  private sendQueuedNow(
    socket: DemoWs,
    id: number,
    p: Record<string, unknown>,
  ): void {
    const chat = this.chat(p.chatId);
    const ix = chat?.queue.findIndex(q => q.id === p.id) ?? -1;
    if (chat === undefined || ix < 0)
      return this.reply(socket, id, { sent: false });
    const [msg] = chat.queue.splice(ix, 1);
    this.emitQueue(chat);
    this.reply(socket, id, { sent: true });
    this.startRun(chat, msg.text, msg.id);
  }

  private steerQueuedNow(
    socket: DemoWs,
    id: number,
    p: Record<string, unknown>,
  ): void {
    const chat = this.chat(p.chatId);
    const ix = chat?.queue.findIndex(q => q.id === p.id) ?? -1;
    if (chat === undefined || ix < 0)
      return this.reply(socket, id, { sent: false });
    const [msg] = chat.queue.splice(ix, 1);
    this.emitQueue(chat);
    this.reply(socket, id, { sent: true });
    this.injectSteer(chat, msg.text);
  }

  private moveQueued(
    socket: DemoWs,
    id: number,
    p: Record<string, unknown>,
  ): void {
    const chat = this.chat(p.chatId);
    const ix = chat?.queue.findIndex(q => q.id === p.id) ?? -1;
    const to = typeof p.toIndex === 'number' ? p.toIndex : -1;
    if (chat === undefined || ix < 0 || to < 0 || to >= chat.queue.length)
      return this.reply(socket, id, { changed: false });
    const [msg] = chat.queue.splice(ix, 1);
    chat.queue.splice(to, 0, msg);
    this.emitQueue(chat);
    return this.reply(socket, id, { changed: true });
  }

  // ── Attachments ──────────────────────────────────────────────────────────

  private uploadChunk(
    socket: DemoWs,
    id: number,
    p: Record<string, unknown>,
  ): void {
    const uploadId = typeof p.uploadId === 'string' ? p.uploadId : '';
    const seq = typeof p.seq === 'number' ? p.seq : 0;
    const data = typeof p.data === 'string' ? p.data : '';
    const u = this.uploads.get(uploadId) ?? { chunks: [] };
    u.chunks[seq] = data;
    this.uploads.set(uploadId, u);
    return this.reply(socket, id, { ok: true });
  }

  private uploadCommit(
    socket: DemoWs,
    id: number,
    p: Record<string, unknown>,
  ): void {
    const uploadId = typeof p.uploadId === 'string' ? p.uploadId : '';
    const fileName =
      typeof p.fileName === 'string' ? p.fileName : 'attachment.png';
    this.uploads.delete(uploadId);
    return this.reply(socket, id, {
      path: `/demo/uploads/${uploadId}-${fileName}`,
    });
  }

  // ── Terminals (echo shell) ────────────────────────────────────────────────

  private subscribeTerminal(
    end: StreamEnd,
    streams: Map<number, () => void>,
    p: Record<string, unknown>,
  ): void {
    const term = this.terminals.get(
      typeof p.terminalId === 'string' ? p.terminalId : '',
    );
    if (term === undefined) {
      end.socket.deliver(
        encodeFrame(
          RPC_FRAME_HEADER,
          enc.encode(
            `${JSON.stringify({
              id: end.id,
              err: 'demo: unknown terminal',
            })}\n`,
          ),
        ),
      );
      return;
    }
    term.watchers.add(end);
    streams.set(end.id, () => term.watchers.delete(end));
    this.termData(term, 'demo$ ');
  }

  private termData(term: Terminal, text: string): void {
    term.seq += 1;
    const event = {
      type: 'data',
      seq: term.seq,
      data: bytesToBase64(enc.encode(text)),
    };
    for (const end of term.watchers) streamItem(end, event);
  }

  private writeTerminal(
    socket: DemoWs,
    id: number,
    p: Record<string, unknown>,
  ): void {
    const term = this.terminals.get(
      typeof p.terminalId === 'string' ? p.terminalId : '',
    );
    if (term === undefined || term.exited)
      return this.replyErr(socket, id, 'demo: unknown terminal');
    const bytes =
      typeof p.data === 'string' ? base64ToBytes(p.data) : new Uint8Array(0);
    for (const ch of dec.decode(bytes)) {
      if (ch === '\r' || ch === '\n') {
        const line = term.line;
        term.line = '';
        let out = '\r\n';
        if (line === 'ls') {
          out += 'README.md  docs  package.json  src\r\n';
        } else if (line !== '') {
          out += `zsh: command not found: ${line}\r\n`;
        }
        out += 'demo$ ';
        this.termData(term, out);
      } else {
        term.line += ch;
        this.termData(term, ch);
      }
    }
    return this.reply(socket, id, {});
  }

  private closeTerminal(
    socket: DemoWs,
    id: number,
    p: Record<string, unknown>,
  ): void {
    const term = this.terminals.get(
      typeof p.terminalId === 'string' ? p.terminalId : '',
    );
    if (term !== undefined && !term.exited) {
      term.exited = true;
      term.seq += 1;
      const event = { type: 'exit', seq: term.seq, exitCode: 0 };
      for (const end of term.watchers) streamItem(end, event);
    }
    return this.reply(socket, id, { closed: true });
  }

  // ── fetchImpl (HTTPS fallbacks — no network, ever) ───────────────────────

  readonly fetchImpl: FetchImpl = async (url, init) => {
    const json = (status: number, body: unknown): FetchResponse => {
      const text = JSON.stringify(body);
      return {
        status,
        headers: { get: () => null },
        arrayBuffer: async () => enc.encode(text).buffer as ArrayBuffer,
        text: async () => text,
      };
    };
    if (url.includes('/nudge')) return json(200, {});
    if (url.includes('/status')) {
      const attached = url.includes(`/${HOST_LIVE}/`);
      return json(200, { attached });
    }
    if (url.includes('/registry/') && url.includes('/rows')) {
      return json(200, { seq: this.seq, full: false, gcFloor: 0, rows: [] });
    }
    if (url.includes('/registry/') && url.includes('/push')) {
      try {
        const body = JSON.parse(
          typeof init.body === 'string' ? init.body : '{}',
        ) as { batch?: string; ops?: Op[] };
        let applied = 0;
        const changed: Row[] = [];
        for (const op of body.ops ?? []) {
          const key = `${op.kind}:${op.id}`;
          const { row, changed: did } = applyOp(this.rows.get(key), op);
          if (did && row !== undefined) {
            this.seq += 1;
            row.seq = this.seq;
            this.rows.set(key, row);
            changed.push(row);
            applied += 1;
          }
        }
        this.broadcastRows(changed);
        return json(200, { seq: this.seq, applied });
      } catch {
        return json(400, { error: 'bad push' });
      }
    }
    return json(404, { error: 'demo: no route' });
  };
}

/** 1×1 transparent PNG — attachment/image reads. */
const TINY_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
