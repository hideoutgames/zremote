// Ported from zeron@853872d crates/rpc/src/lib.rs frame shapes and
// apps/ios/ZeronTests DeviceRpcPending routing semantics
// (DeviceRelayClient.swift DeviceRpcPending.route).

import { RpcDemux } from '../rpc';

const collect = () => {
  const events: [string, unknown][] = [];
  return {
    events,
    handlers: {
      onOk: (v: unknown) => events.push(['ok', v]),
      onErr: (e: string) => events.push(['err', e]),
      onItem: (i: unknown) => events.push(['item', i]),
      onDone: (e?: string) => events.push(['done', e]),
    },
  };
};

describe('RpcDemux', () => {
  it('resolves a unary call on ok, fails on err', () => {
    const demux = new RpcDemux();
    const a = collect();
    demux.register(1, a.handlers);
    expect(demux.owns(1)).toBe(true);
    expect(demux.handleNdjson('{"id":1,"ok":{"deviceId":"d1"}}')).toBe(1);
    expect(a.events).toEqual([['ok', { deviceId: 'd1' }]]);
    expect(demux.owns(1)).toBe(false);

    const b = collect();
    demux.register(2, b.handlers);
    demux.handleNdjson('{"id":2,"err":"nope"}');
    expect(b.events).toEqual([['err', 'nope']]);
  });

  it('streams: ok is a readiness ack — the stream stays live', () => {
    const demux = new RpcDemux();
    const s = collect();
    demux.register(7, { ...s.handlers, stream: true });
    demux.handleNdjson('{"id":7,"ok":true}');
    expect(demux.owns(7)).toBe(true); // readiness, not termination
    demux.handleNdjson('{"id":7,"item":{"n":1}}\n{"id":7,"item":{"n":2}}');
    demux.handleNdjson('{"id":7,"done":true}');
    expect(s.events).toEqual([
      ['item', { n: 1 }],
      ['item', { n: 2 }],
      ['done', undefined],
    ]);
    expect(demux.owns(7)).toBe(false);
  });

  it('streams terminate on err and on unexpected frames', () => {
    const demux = new RpcDemux();
    const a = collect();
    const b = collect();
    demux.register(1, { ...a.handlers, stream: true });
    demux.register(2, { ...b.handlers, stream: true });
    demux.handleNdjson('{"id":1,"err":"boom"}');
    expect(a.events).toEqual([['done', 'boom']]);
    expect(demux.owns(1)).toBe(false);
    demux.handleNdjson('{"id":2,"bogus":1}');
    expect(b.events).toEqual([['done', 'unexpected reply']]);
  });

  it('demultiplexes interleaved unary and stream replies in one payload', () => {
    const demux = new RpcDemux();
    const u = collect();
    const s = collect();
    demux.register(1, u.handlers);
    demux.register(2, { ...s.handlers, stream: true });
    demux.handleNdjson(
      [
        '{"id":2,"item":"a"}',
        '{"id":1,"ok":42}',
        '{"id":2,"item":"b"}',
        '{"id":2,"done":true}',
      ].join('\n'),
    );
    expect(u.events).toEqual([['ok', 42]]);
    expect(s.events).toEqual([
      ['item', 'a'],
      ['item', 'b'],
      ['done', undefined],
    ]);
  });

  it('ignores malformed lines and unknown ids', () => {
    const demux = new RpcDemux();
    const u = collect();
    demux.register(1, u.handlers);
    expect(demux.handleNdjson('{bad json}\n{"id":99,"ok":1}\n{"ok":2}')).toBe(
      0,
    );
    expect(demux.handleNdjson('{"id":1,"ok":"fine"}')).toBe(1);
    expect(u.events).toEqual([['ok', 'fine']]);
  });

  it('unary unexpected reply fails with err', () => {
    const demux = new RpcDemux();
    const u = collect();
    demux.register(3, u.handlers);
    demux.handleNdjson('{"id":3,"item":1}');
    expect(u.events).toEqual([['err', 'unexpected reply']]);
    expect(demux.owns(3)).toBe(false);
  });

  it('failAll drains everything; stream terminal sees the request gone', () => {
    const demux = new RpcDemux();
    const u = collect();
    const s = collect();
    let ownedDuringDone: boolean | undefined;
    demux.register(1, u.handlers);
    demux.register(2, {
      ...s.handlers,
      stream: true,
      onDone: (e?: string) => {
        ownedDuringDone = demux.owns(2);
        s.handlers.onDone?.(e);
      },
    });
    demux.failAll('socket dropped');
    expect(u.events).toEqual([['err', 'socket dropped']]);
    expect(s.events).toEqual([['done', 'socket dropped']]);
    expect(ownedDuringDone).toBe(false);
    expect(demux.unaryCount).toBe(0);
    expect(demux.streamCount).toBe(0);
  });
});
