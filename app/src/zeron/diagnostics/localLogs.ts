// Account-scoped diagnostic logs for maintainer handoff. One .txt per agent
// run, under logs/{chatId}/. Callers pass redaction-safe fields only —
// prompts, transcript text, tool arguments, and secrets never belong here.
// `redact()` is still applied to every line. While the pref is off, no
// directory and no file is created.

import { redact } from '../log';
import type { LocalLogFs } from './localLogFs';

/** Soft cap per run file. The truncation marker may land a few bytes past it. */
export const MAX_LOG_BYTES = 512 * 1024;

const RING_CAP = 40;

export interface LocalLogWriterDeps {
  fs: LocalLogFs;
  /** `{documents}/zeron/{orgId}/{userId}/logs` */
  logsRoot: string;
  enabled: () => boolean;
  now?: () => number;
  sessionMode: 'doc' | 'relay';
}

export interface BeginRun {
  chatId: string;
  hostDeviceId: string;
  roomGen?: number;
  status: string;
}

interface OpenRun {
  chatId: string;
  hostDeviceId: string;
  path: string;
  startedAt: number;
  bytes: number;
  truncated: boolean;
  /** Footer may still land after the cap. */
  closing: boolean;
  dropped: boolean;
  queue: Promise<void>;
}

export interface LocalLogThread {
  chatId: string;
  latestAt: number;
  fileCount: number;
}

export interface LocalLogFile {
  name: string;
  path: string;
  at: number;
}

const pushRing = (ring: string[], line: string): void => {
  ring.push(line);
  if (ring.length > RING_CAP) ring.splice(0, ring.length - RING_CAP);
};

/** `2026-09-21T18:17:03.102Z` → `2026-09-21T18-17-03` (UTC, second resolution). */
export const fileStamp = (at: number): string =>
  new Date(at).toISOString().slice(0, 19).replace(/:/g, '-');

/** Inverse of `fileStamp`. Collision suffixes (`-2`) are ignored. */
export const parseLogFileAt = (name: string): number | undefined => {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})(?:-\d+)?\.txt$/.exec(
    name,
  );
  if (m === null) return undefined;
  const at = Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}Z`);
  return Number.isNaN(at) ? undefined : at;
};

/** Local time, with the date when `at` is not the same calendar day as `now`. */
export const formatLogStamp = (at: number, now: number): string => {
  const when = new Date(at);
  const today = new Date(now);
  const sameDay =
    when.getFullYear() === today.getFullYear() &&
    when.getMonth() === today.getMonth() &&
    when.getDate() === today.getDate();
  const time = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  }).format(when);
  if (sameDay) return time;
  const date = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(when);
  return `${date}, ${time}`;
};

export const logsRootFor = (
  baseDir: string,
  orgId: string,
  userId: string,
): string =>
  [baseDir.replace(/\/$/, ''), 'zeron', orgId, userId, 'logs'].join('/');

const safeChatId = (chatId: string): string => chatId.replace(/[\\/]/g, '_');

export class LocalLogWriter {
  private readonly open = new Map<string, OpenRun>();
  private readonly opening = new Set<string>();
  private readonly chatBuffers = new Map<string, string[]>();
  private readonly hostRings = new Map<string, string[]>();
  private readonly registryRing: string[] = [];
  private readonly pendingEnd = new Map<string, string>();
  private readonly listeners = new Set<() => void>();
  private epoch = 0;

  constructor(private readonly deps: LocalLogWriterDeps) {}

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  isEnabled(): boolean {
    return this.deps.enabled();
  }

  isOpen(chatId: string): boolean {
    return this.open.has(chatId);
  }

  isOpening(chatId: string): boolean {
    return this.opening.has(chatId);
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  private format(line: string): string {
    const text = redact(line.replace(/\s+$/g, ''));
    return `${new Date(this.now()).toISOString()} ${text}\n`;
  }

  /** Queue `chunk` onto the run file. No-op when logging is off or the run was dropped. */
  private write(run: OpenRun, chunk: string, force = false): Promise<void> {
    if (run.dropped) return run.queue;
    if (!force && !this.deps.enabled()) return run.queue;
    if (!force && run.truncated) return run.queue;
    let body = chunk;
    if (!force && run.bytes + body.length > MAX_LOG_BYTES) {
      const room = Math.max(0, MAX_LOG_BYTES - run.bytes);
      body = `${body.slice(0, room)}\n… log truncated\n`;
      run.truncated = true;
    }
    run.bytes += body.length;
    const path = run.path;
    const next = run.queue.then(() => {
      if (run.dropped) return;
      if (!force && !this.deps.enabled()) return;
      return this.deps.fs.appendText(path, body);
    });
    run.queue = next.catch(() => {});
    return next;
  }

  /** Fire-and-forget write. Failures stay on the run queue and must not surface. */
  private enqueue(run: OpenRun, chunk: string): void {
    this.write(run, chunk).catch(() => {});
  }

  /**
   * Open the run file. Lines recorded while enabled but before the file
   * exists are flushed in front of the header. Returns without touching
   * the filesystem when logging is off.
   */
  beginRun(info: BeginRun): Promise<void> {
    if (!this.deps.enabled()) return Promise.resolve();
    if (this.open.has(info.chatId) || this.opening.has(info.chatId)) {
      return Promise.resolve();
    }
    this.opening.add(info.chatId);
    const epoch = this.epoch;
    return this.openFile(info, epoch).finally(() => {
      this.opening.delete(info.chatId);
    });
  }

  private async openFile(info: BeginRun, epoch: number): Promise<void> {
    const dir = `${this.deps.logsRoot}/${safeChatId(info.chatId)}`;
    const existing = await this.deps.fs.list(dir);
    if (epoch !== this.epoch || !this.deps.enabled()) {
      this.chatBuffers.delete(info.chatId);
      this.pendingEnd.delete(info.chatId);
      return;
    }
    const stamp = fileStamp(this.now());
    const names = new Set(existing.map(e => e.name));
    let name = `${stamp}.txt`;
    let n = 2;
    while (names.has(name)) {
      name = `${stamp}-${n}.txt`;
      n += 1;
    }
    const startedAt = this.now();
    const run: OpenRun = {
      chatId: info.chatId,
      hostDeviceId: info.hostDeviceId,
      path: `${dir}/${name}`,
      startedAt,
      bytes: 0,
      truncated: false,
      closing: false,
      dropped: false,
      queue: Promise.resolve(),
    };
    this.open.set(info.chatId, run);
    const buffered = this.chatBuffers.get(info.chatId) ?? [];
    this.chatBuffers.delete(info.chatId);
    const host = this.hostRings.get(info.hostDeviceId) ?? [];
    const preamble = [...this.registryRing, ...host, ...buffered].join('');
    const roomGen = info.roomGen ?? 0;
    const header = this.format(
      `run start chat=${info.chatId} device=${info.hostDeviceId} mode=${this.deps.sessionMode} roomGen=${roomGen} status=${info.status}`,
    );
    await this.write(run, `${preamble}${header}`);
    const endStatus = this.pendingEnd.get(info.chatId);
    if (endStatus !== undefined) {
      this.pendingEnd.delete(info.chatId);
      await this.finish(run, endStatus);
    }
    this.emit();
  }

  /** Append a redacted line. Buffers until the run file exists. No-op when disabled. */
  append(chatId: string, line: string): void {
    if (!this.deps.enabled()) return;
    const formatted = this.format(line);
    const run = this.open.get(chatId);
    if (run === undefined) {
      const ring = this.chatBuffers.get(chatId) ?? [];
      pushRing(ring, formatted);
      this.chatBuffers.set(chatId, ring);
      return;
    }
    this.enqueue(run, formatted);
  }

  /**
   * Mirror an already-redacted runtime log line into the open run it belongs
   * to. Registry lines go to every open run. No-op when disabled.
   */
  route(line: string): void {
    if (!this.deps.enabled()) return;
    const formatted = this.format(line);
    if (line.startsWith('registry:')) {
      pushRing(this.registryRing, formatted);
      for (const run of this.open.values()) this.enqueue(run, formatted);
      return;
    }
    if (line.startsWith('loro ')) {
      const safe = this.format('loro unavailable — relay mode');
      pushRing(this.registryRing, safe);
      for (const run of this.open.values()) this.enqueue(run, safe);
      return;
    }
    const chat2 = /^chat2 ([^:\s]+):/.exec(line);
    if (chat2 !== null) {
      const chatId = chat2[1];
      if (chatId === undefined) return;
      const run = this.open.get(chatId);
      if (run === undefined) {
        const ring = this.chatBuffers.get(chatId) ?? [];
        pushRing(ring, formatted);
        this.chatBuffers.set(chatId, ring);
      } else {
        this.enqueue(run, formatted);
      }
      return;
    }
    const relay = /^relay ([^:\s]+):/.exec(line);
    if (relay === null) return;
    const hostId = relay[1];
    if (hostId === undefined) return;
    const ring = this.hostRings.get(hostId) ?? [];
    pushRing(ring, formatted);
    this.hostRings.set(hostId, ring);
    for (const run of this.open.values()) {
      if (run.hostDeviceId === hostId) this.enqueue(run, formatted);
    }
  }

  endRun(chatId: string, status: string): Promise<void> {
    const run = this.open.get(chatId);
    if (run === undefined) {
      if (this.opening.has(chatId)) this.pendingEnd.set(chatId, status);
      return Promise.resolve();
    }
    return this.finish(run, status);
  }

  private finish(run: OpenRun, status: string): Promise<void> {
    const duration = Math.max(0, this.now() - run.startedAt);
    run.closing = true;
    const footer = this.format(
      `run end status=${status} durationMs=${duration}`,
    );
    const pending = this.write(run, footer, true);
    this.open.delete(run.chatId);
    this.pendingEnd.delete(run.chatId);
    this.emit();
    return pending;
  }

  async deleteAll(): Promise<void> {
    this.epoch += 1;
    const pending: Promise<void>[] = [];
    for (const run of this.open.values()) {
      run.dropped = true;
      pending.push(run.queue);
    }
    this.open.clear();
    this.opening.clear();
    this.chatBuffers.clear();
    this.hostRings.clear();
    this.registryRing.length = 0;
    this.pendingEnd.clear();
    await Promise.all(pending);
    await this.deps.fs.deleteTree(this.deps.logsRoot);
    this.emit();
  }

  async listThreads(): Promise<LocalLogThread[]> {
    const entries = await this.deps.fs.list(this.deps.logsRoot);
    const threads: LocalLogThread[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory) continue;
      const files = await this.listFiles(entry.name);
      if (files.length === 0) continue;
      const latest = files[0];
      if (latest === undefined) continue;
      threads.push({
        chatId: entry.name,
        latestAt: latest.at,
        fileCount: files.length,
      });
    }
    threads.sort((a, b) => b.latestAt - a.latestAt);
    return threads;
  }

  async listFiles(chatId: string): Promise<LocalLogFile[]> {
    const dir = `${this.deps.logsRoot}/${safeChatId(chatId)}`;
    const entries = await this.deps.fs.list(dir);
    const files: LocalLogFile[] = [];
    for (const entry of entries) {
      if (entry.isDirectory) continue;
      const at = parseLogFileAt(entry.name);
      if (at === undefined) continue;
      files.push({ name: entry.name, path: `${dir}/${entry.name}`, at });
    }
    files.sort((a, b) => b.at - a.at);
    return files;
  }

  read(path: string): Promise<string | undefined> {
    const root = `${this.deps.logsRoot}/`;
    if (!path.startsWith(root)) return Promise.resolve(undefined);
    return this.deps.fs.readText(path);
  }
}

let writer: LocalLogWriter | undefined;

export const installLocalLogWriter = (
  next: LocalLogWriter | undefined,
): void => {
  writer = next;
};

export const currentLocalLogWriter = (): LocalLogWriter | undefined => writer;

export const routeRuntimeLog = (line: string): void => {
  writer?.route(line);
};

/** Safe diagnostic line for an open (or soon-open) run. No-op when disabled. */
export const noteLocalDiagnostic = (chatId: string, line: string): void => {
  writer?.append(chatId, line);
};

export const deleteLocalLogs = (): Promise<void> =>
  writer?.deleteAll() ?? Promise.resolve();

export const listLocalLogThreads = (): Promise<LocalLogThread[]> =>
  writer?.listThreads() ?? Promise.resolve([]);

export const listLocalLogFiles = (chatId: string): Promise<LocalLogFile[]> =>
  writer?.listFiles(chatId) ?? Promise.resolve([]);

export const readLocalLog = (path: string): Promise<string | undefined> =>
  writer?.read(path) ?? Promise.resolve(undefined);

export const subscribeLocalLogs = (listener: () => void): (() => void) =>
  writer?.subscribe(listener) ?? (() => {});
