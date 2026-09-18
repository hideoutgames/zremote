import {
  InputCoalescer,
  ResizeDebouncer,
  TerminalClient,
  openTerminal,
} from '../src/zeron/terminal/client';
import { base64Decode } from '../src/zeron/terminal/ansi';
import type { TerminalEvent } from '../src/zeron/protocol/types';

class FakeClock {
  now = 0;
  timers: { at: number; cb: () => void; id: number }[] = [];
  nextId = 1;
  setTimeout(cb: () => void, ms: number) {
    const id = this.nextId++;
    this.timers.push({ at: this.now + ms, cb, id });
    return id;
  }
  clearTimeout(id: unknown) {
    this.timers = this.timers.filter(t => t.id !== id);
  }
  advance(ms: number) {
    this.now += ms;
    for (const tm of [...this.timers].filter(x => x.at <= this.now)) {
      this.timers = this.timers.filter(x => x.id !== tm.id);
      tm.cb();
    }
  }
}

const session = { id: 't1', cwd: '/repo', shell: 'zsh' };

const relay = (events: TerminalEvent[]) => {
  const calls: { method: string; params: Record<string, unknown> }[] = [];
  const streams: Record<string, unknown>[] = [];
  return {
    calls,
    streams,
    call: jest.fn(async (method: string, params: Record<string, unknown>) => {
      calls.push({ method, params });
      return method === 'OpenTerminal' ? session : { ok: true };
    }),
    stream: jest.fn(async (method: string, params: Record<string, unknown>) => {
      streams.push(params);
      return {
        items: (async function* () {
          for (const e of events) yield e;
        })(),
        cancel: () => {},
      };
    }),
  };
};

test('open → subscribe replay-then-tail with afterSeq resume', async () => {
  const events: TerminalEvent[] = [
    { type: 'data', seq: 1, data: 'aGk=' },
    { type: 'data', seq: 2, data: 'eA==' },
  ];
  const r = relay(events);
  const s = await openTerminal(r as never, 'c1', 80, 24);
  expect(r.calls[0]).toEqual({
    method: 'OpenTerminal',
    params: { chatId: 'c1', cols: 80, rows: 24 },
  });
  const seen: TerminalEvent[] = [];
  const client = new TerminalClient(r as never, s, e => seen.push(e));
  await client.subscribe();
  expect(r.streams[0]).toEqual({ terminalId: 't1', afterSeq: 0 });
  expect(seen).toHaveLength(2);
  expect(client.handle.lastSeq).toBe(2);
  // Resume: subscribes from lastSeq, not a new shell.
  await client.subscribe();
  expect(r.streams[1]).toEqual({ terminalId: 't1', afterSeq: 2 });
});

test('exit marks the handle and ends the stream', async () => {
  const r = relay([{ type: 'exit', seq: 9, exitCode: 0 }]);
  const seen: TerminalEvent[] = [];
  const client = new TerminalClient(r as never, session, e => seen.push(e));
  await client.subscribe();
  expect(client.handle.exited).toBe(true);
  expect(client.handle.exitCode).toBe(0);
  // Input to an exited shell is dropped.
  client.input(new Uint8Array([65]));
});

test('input coalesces within 12ms', async () => {
  const clock = new FakeClock();
  const flushed: Uint8Array[] = [];
  const c = new InputCoalescer(b => flushed.push(b), clock);
  c.push(new Uint8Array([97]));
  c.push(new Uint8Array([98]));
  clock.advance(12);
  c.push(new Uint8Array([99]));
  clock.advance(12);
  expect(flushed).toEqual([new Uint8Array([97, 98]), new Uint8Array([99])]);
});

test('writes go out base64', async () => {
  const clock = new FakeClock();
  const r = relay([]);
  const client = new TerminalClient(r as never, session, () => {}, clock);
  client.input(new Uint8Array([104, 105])); // "hi"
  clock.advance(12);
  await Promise.resolve();
  const w = r.calls.find(c => c.method === 'WriteTerminal');
  expect(w).toBeDefined();
  expect([...base64Decode(w!.params.data as string)]).toEqual([104, 105]);
});

test('resize debounces 80ms and skips no-ops', async () => {
  const clock = new FakeClock();
  const sent: [number, number][] = [];
  const d = new ResizeDebouncer((c, r) => sent.push([c, r]), clock);
  d.push(80, 24);
  d.push(80, 24); // no-op
  d.push(100, 30);
  clock.advance(80);
  d.push(120, 40);
  clock.advance(40);
  d.push(130, 44);
  clock.advance(80);
  expect(sent).toEqual([
    [100, 30],
    [130, 44],
  ]);
});

test('close calls CloseTerminal and marks exited', async () => {
  const r = relay([]);
  const client = new TerminalClient(r as never, session, () => {});
  await client.close();
  expect(r.calls.find(c => c.method === 'CloseTerminal')).toEqual({
    method: 'CloseTerminal',
    params: { terminalId: 't1' },
  });
  expect(client.handle.exited).toBe(true);
});
