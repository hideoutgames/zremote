// Relay session mode: applyTranscriptFrame vectors ported from
// crates/doc/src/transcript_delta.rs tests, plus the RelaySessionSource
// lifecycle against a fake relay (reset → delta → teardown → reopen) and
// runtime fallback selection when deps.loro() throws.

import {
  applyTranscriptFrame,
  RelaySessionSource,
  TranscriptDesync,
} from '../relaySessionSource';
import {
  getSessionStore,
  resetSessionStores,
  runPhase,
} from '../../state/sessionStores';
import { resetWorkspace } from '../../state/workspaceStore';
import { FakeClock } from '../../transport/clock';
import type { MessageEntry } from '../../protocol/types';
import type { RelayLike } from '../../attachments/upload';
import { AppRuntime } from '../appRuntime';
import { LoroCrdtAdapter } from '../../doc/loroCrdtAdapter';
import { staticTokenSource } from '../../transport/tokenSource';
import { FakeWsHub, fakeFetch } from '../../testing/fakeWs';
import { memDisk, flush } from '../../testing/memDisk';
import { setForceRelayMode, uiPrefsStore } from '../../state/uiPrefs';
import { PROJECT_COALESCE_MS } from '../../state/projectCoalesce';

const entry = (id: string, text: string): MessageEntry => ({
  id,
  role: 'assistant',
  parts: [{ kind: 'text', id: 't0', text }],
  createdAt: 0,
  deviceId: 'dev',
});

const ids = (es: readonly MessageEntry[]) => es.map(e => e.id);
const texts = (es: readonly MessageEntry[]) =>
  es.map(e => (e.parts[0] as { text: string }).text);

describe('applyTranscriptFrame', () => {
  it('reset replaces the whole transcript', () => {
    const cur = [entry('old', 'x')];
    applyTranscriptFrame(cur, { reset: [entry('a', 'hello')] });
    expect(ids(cur)).toEqual(['a']);
    expect(texts(cur)).toEqual(['hello']);
  });

  it('upsert appends at the tail and rewrites in place', () => {
    const cur = [entry('a', 'hello')];
    applyTranscriptFrame(cur, {
      upsert: [{ after: 'a', entry: entry('b', 'wor') }],
      append: [],
      remove: [],
      count: 2,
    });
    // A non-append rewrite of b is a full upsert (diff_transcript's
    // "non_append_change_falls_back_to_upsert" case).
    applyTranscriptFrame(cur, {
      upsert: [{ after: 'a', entry: entry('b', 'world') }],
      append: [],
      remove: [],
      count: 2,
    });
    expect(texts(cur)).toEqual(['hello', 'world']);
  });

  it('mid-list insert honors the after anchor (None = head)', () => {
    const cur = [entry('a', '1'), entry('c', '3')];
    applyTranscriptFrame(cur, {
      upsert: [{ after: 'a', entry: entry('b', '2') }],
      append: [],
      remove: [],
      count: 3,
    });
    expect(ids(cur)).toEqual(['a', 'b', 'c']);
    applyTranscriptFrame(cur, {
      upsert: [{ after: null, entry: entry('z', '0') }],
      append: [],
      remove: [],
      count: 4,
    });
    expect(ids(cur)).toEqual(['z', 'a', 'b', 'c']);
  });

  it('text append grows a text part; len is a UTF-8 byte tripwire', () => {
    const cur = [entry('a', 'prompt'), entry('b', 'streaming…')];
    applyTranscriptFrame(cur, {
      upsert: [],
      append: [
        {
          entry: 'b',
          part: 't0',
          text: ' more',
          // len is a UTF-8 BYTE length (Rust str::len), not UTF-16 units.
          len: Buffer.byteLength('streaming… more', 'utf8'),
        },
      ],
      remove: [],
      count: 2,
    });
    expect(texts(cur)).toEqual(['prompt', 'streaming… more']);
  });

  it('text append targets reasoning parts too', () => {
    const cur: MessageEntry[] = [
      {
        ...entry('b', ''),
        parts: [{ kind: 'reasoning', id: 'r0', text: 'thinking' }],
      },
    ];
    applyTranscriptFrame(cur, {
      upsert: [],
      append: [
        { entry: 'b', part: 'r0', text: ' more', len: 'thinking more'.length },
      ],
      remove: [],
      count: 1,
    });
    expect((cur[0].parts[0] as { text: string }).text).toBe('thinking more');
  });

  it('remove drops entries; status changes ride upserts', () => {
    const done = { ...entry('a', 'x'), status: 'complete' as const };
    const cur = [entry('a', 'x'), entry('b', 'y')];
    applyTranscriptFrame(cur, {
      upsert: [{ after: null, entry: done }],
      append: [],
      remove: ['b'],
      count: 1,
    });
    expect(ids(cur)).toEqual(['a']);
    expect(cur[0].status).toBe('complete');
  });

  it('missing anchor is a desync', () => {
    const cur: MessageEntry[] = [];
    expect(() =>
      applyTranscriptFrame(cur, {
        upsert: [{ after: 'missing', entry: entry('x', '1') }],
        append: [],
        remove: [],
        count: 2,
      }),
    ).toThrow(TranscriptDesync);
  });

  it('missing append part / length mismatch / count mismatch desync', () => {
    expect(() =>
      applyTranscriptFrame([entry('a', 'hello')], {
        upsert: [],
        append: [{ entry: 'a', part: 'nope', text: 'x', len: 6 }],
        remove: [],
        count: 1,
      }),
    ).toThrow(TranscriptDesync);
    expect(() =>
      applyTranscriptFrame([entry('a', 'hello')], {
        upsert: [],
        append: [{ entry: 'a', part: 't0', text: 'x', len: 99 }],
        remove: [],
        count: 1,
      }),
    ).toThrow(TranscriptDesync);
    expect(() =>
      applyTranscriptFrame([entry('a', 'hello')], {
        upsert: [],
        append: [],
        remove: [],
        count: 3,
      }),
    ).toThrow(TranscriptDesync);
  });
});

// ── RelaySessionSource lifecycle ───────────────────────────────────────

const CHAT = 'c-relay';
const utf8 = (s: string) => Buffer.byteLength(s, 'utf8');

/** A controllable async-iterable fake relay stream. */
class FakeStream {
  private queue: unknown[] = [];
  private waiters: ((v: IteratorResult<unknown>) => void)[] = [];
  cancelled = false;
  ended = false;
  push(v: unknown): void {
    const w = this.waiters.shift();
    if (w) w({ value: v, done: false });
    else this.queue.push(v);
  }
  end(): void {
    this.ended = true;
    while (this.waiters.length > 0)
      this.waiters.shift()!({ value: undefined, done: true });
  }
  get items(): AsyncIterable<unknown> {
    const next = (): Promise<IteratorResult<unknown>> => {
      const v = this.queue.shift();
      if (v !== undefined) return Promise.resolve({ value: v, done: false });
      if (this.ended || this.cancelled)
        return Promise.resolve({ value: undefined, done: true });
      return new Promise(r => this.waiters.push(r));
    };
    return { [Symbol.asyncIterator]: () => ({ next }) };
  }
  cancel(): void {
    this.cancelled = true;
    while (this.waiters.length > 0)
      this.waiters.shift()!({ value: undefined, done: true });
  }
}

class FakeRelay implements RelayLike {
  calls: { method: string; params: Record<string, unknown> }[] = [];
  failNext: unknown;
  transcriptStreams: FakeStream[] = [];
  queueStreams: FakeStream[] = [];
  async call<T>(method: string, params: Record<string, unknown>): Promise<T> {
    this.calls.push({ method, params });
    if (this.failNext !== undefined) {
      const e = this.failNext;
      this.failNext = undefined;
      throw e;
    }
    if (method === 'QueueCommand')
      return { commandId: `cmd-${this.calls.length}` } as T;
    if (method === 'QueueMessage') return { id: 'q1' } as T;
    return {} as T;
  }
  async stream(): Promise<never> {
    throw new Error('untyped');
  }
  async streamTyped(method: string): Promise<FakeStream> {
    const s = new FakeStream();
    if (method === 'WatchDocMessages') this.transcriptStreams.push(s);
    else this.queueStreams.push(s);
    return s;
  }
}

const makeSource = (
  opts: {
    relay?: FakeRelay;
    sessionRow?: () => { status?: string } | undefined;
  } = {},
) => {
  const clock = new FakeClock(1_000_000);
  const relay = opts.relay ?? new FakeRelay();
  // RelayLike.stream is optional; give ours the method dispatch.
  const withStream: RelayLike = {
    call: (m, p) => relay.call(m, p),
    stream: <T>(m: string) =>
      relay.streamTyped(m) as unknown as Promise<{
        items: AsyncIterable<T>;
        cancel(): void;
      }>,
  };
  const src = new RelaySessionSource(CHAT, {
    deviceId: 'phone1',
    clock,
    relayFor: () => withStream,
    chatMeta: () => ({ hostDeviceId: 'host1' }),
    sessionRow: opts.sessionRow,
  });
  return { src, clock, relay };
};

const store = () => getSessionStore(CHAT).getState();

const drain = async (clock: FakeClock): Promise<void> => {
  await flush();
  clock.advance(PROJECT_COALESCE_MS);
  await flush();
};

describe('RelaySessionSource', () => {
  afterEach(() => {
    resetSessionStores();
    resetWorkspace();
  });

  it('reset then delta lands entries + contextUsage; queue lands rows', async () => {
    const { src, relay, clock } = makeSource();
    src.start();
    await flush();
    const ts = relay.transcriptStreams[0];
    ts.push({
      reset: [entry('u1', 'hi')],
      contextUsage: { tokens: 12, window: 200000 },
    });
    await drain(clock);
    expect(ids(store().entries)).toEqual(['u1']);
    expect(store().meta.contextUsage?.tokens).toBe(12);
    ts.push({
      upsert: [{ after: 'u1', entry: entry('a1', 'wor') }],
      append: [],
      remove: [],
      count: 2,
    });
    ts.push({
      upsert: [],
      append: [{ entry: 'a1', part: 't0', text: 'ld', len: utf8('world') }],
      remove: [],
      count: 2,
    });
    await drain(clock);
    expect(texts(store().entries)).toEqual(['hi', 'world']);
    expect(store().meta.contextUsage).toEqual({
      tokens: 12,
      window: 200000,
    });
    relay.queueStreams[0].push({ items: [{ id: 'q1', text: 'later' }] });
    await flush();
    expect(store().queue.map(q => q.id)).toEqual(['q1']);
    src.stop();
  });

  it('burst transcript frames share store writes via the quiet window', async () => {
    const { src, relay, clock } = makeSource();
    src.start();
    await flush();
    let writes = 0;
    const unsub = getSessionStore(CHAT).subscribe(() => {
      writes += 1;
    });
    writes = 0;
    const ts = relay.transcriptStreams[0];
    ts.push({ reset: [entry('a', 'h')] });
    ts.push({
      upsert: [{ after: 'a', entry: entry('b', 'i') }],
      append: [],
      remove: [],
      count: 2,
    });
    ts.push({
      upsert: [{ after: 'b', entry: entry('c', 'j') }],
      append: [],
      remove: [],
      count: 3,
    });
    ts.push({
      upsert: [{ after: 'c', entry: entry('d', 'k') }],
      append: [],
      remove: [],
      count: 4,
    });
    expect(store().entries).toHaveLength(0);
    await drain(clock);
    expect(writes).toBeLessThanOrEqual(2);
    expect(ids(store().entries)).toEqual(['a', 'b', 'c', 'd']);
    unsub();
    src.stop();
  });

  it('teardown reopens streams and the new reset replaces state', async () => {
    const { src, clock, relay } = makeSource();
    src.start();
    await flush();
    relay.transcriptStreams[0].push({ reset: [entry('a', 'x')] });
    await drain(clock);
    expect(ids(store().entries)).toEqual(['a']);
    // Host tears the stream down; reopen after REOPEN_MS.
    relay.transcriptStreams[0].end();
    relay.queueStreams[0].end();
    await flush();
    clock.advance(1_100);
    await flush();
    expect(relay.transcriptStreams.length).toBe(2);
    relay.transcriptStreams[1].push({ reset: [entry('b', 'fresh')] });
    await drain(clock);
    // Reset REPLACES — no merge/dedupe.
    expect(ids(store().entries)).toEqual(['b']);
    src.stop();
  });

  it('QueueCommand error moves the pending send to failedSends', async () => {
    const { src, relay } = makeSource();
    src.start();
    await flush();
    relay.failNext = new Error('host exploded');
    src.sendRun('do it', {}, {});
    await flush();
    const s = store();
    expect(s.pendingSends).toEqual([]);
    expect(s.failedSends.length).toBe(1);
    expect(s.failedSends[0].status).toBe('rejected');
    expect(s.failedSends[0].text).toBe('do it');
    src.stop();
  });

  it('a QueueCommand reply = synchronized (pending command, not unsynced)', async () => {
    const { src, relay } = makeSource();
    src.start();
    await flush();
    relay.transcriptStreams[0].push({ reset: [] });
    await flush();
    src.sendRun('run it', {}, {});
    await flush();
    const s = store();
    const cmd = s.commands.find(c => c.kind === 'run');
    expect(cmd).toBeDefined();
    expect(s.unsyncedCommandIds).toEqual([]);
    const phase = runPhase(
      s,
      { status: 'idle', updatedAt: 0 } as never,
      undefined,
      'phone1',
      Date.now(),
    );
    expect(phase).toBe('synchronized');
    src.stop();
  });

  it('interrupt holds stopping until the session row leaves working', async () => {
    let rowStatus: string | undefined = 'working';
    const { src, relay, clock } = makeSource({
      sessionRow: () => ({ status: rowStatus }),
    });
    src.start();
    await flush();
    relay.transcriptStreams[0].push({ reset: [entry('a', 'x')] });
    await drain(clock);
    src.interrupt();
    await flush();
    let s = store();
    expect(
      runPhase(
        s,
        { status: 'working', updatedAt: Date.now() } as never,
        undefined,
        'phone1',
        Date.now(),
      ),
    ).toBe('stopping');
    rowStatus = 'idle';
    relay.transcriptStreams[0].push({
      upsert: [],
      append: [],
      remove: [],
      count: 1,
    });
    await drain(clock);
    s = store();
    expect(s.commands.find(c => c.kind === 'interrupt')?.status).toBe(
      'applied',
    );
    src.stop();
  });
});

// ── Runtime fallback selection ─────────────────────────────────────────

describe('AppRuntime session-mode selection', () => {
  afterEach(() => {
    resetWorkspace();
    resetSessionStores();
    setForceRelayMode(false);
    uiPrefsStore.setState({ forceRelayMode: false });
  });

  const deps = (loro: () => LoroCrdtAdapter) => ({
    cfg: { baseUrl: 'https://edge.test' },
    tokenSource: staticTokenSource('u@o1'),
    deviceId: 'phone1',
    deviceName: 'Test Phone',
    orgId: 'o1',
    userId: 'u1',
    wsFactory: new FakeWsHub().factory,
    clock: new FakeClock(1_000_000),
    docDisk: memDisk().disk,
    loro,
    fetchImpl: fakeFetch(() => ({ status: 500 })).fetchImpl,
  });

  it('loro() throwing selects relay mode', async () => {
    const rt = await AppRuntime.create(
      deps(() => {
        throw new Error('Nitro module missing');
      }),
    );
    expect(rt.sessionMode).toBe('relay');
    rt.stop();
  });

  it('loro() ok keeps doc mode', async () => {
    const rt = await AppRuntime.create(deps(() => new LoroCrdtAdapter()));
    expect(rt.sessionMode).toBe('doc');
    rt.stop();
  });

  it('forceRelayMode picks relay even when loro works', async () => {
    setForceRelayMode(true);
    const rt = await AppRuntime.create(deps(() => new LoroCrdtAdapter()));
    expect(rt.sessionMode).toBe('relay');
    rt.stop();
  });
});
