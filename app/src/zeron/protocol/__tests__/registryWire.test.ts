// Ported from zeron@853872d docs/registry-sync.md "Wire protocol" frames
// and apps/ios/Zeron/Sync/RegistryClient.swift frame handling.

import { encodeClientFrame, parseServerFrame } from '../registryWire';
import { encodeHlc, type Row } from '../registryCore';

const row: Row = {
  kind: 'chats',
  id: 'c1',
  seq: 4,
  deleted: false,
  fields: { title: 'hi' },
  clocks: { title: encodeHlc(1000, 0, 'dev-a') },
};

describe('registry wire frames', () => {
  it('encodes client frames as JSON text', () => {
    expect(
      encodeClientFrame({ t: 'hello', cursor: null, device: 'dev-a' }),
    ).toBe('{"t":"hello","cursor":null,"device":"dev-a"}');
    expect(
      JSON.parse(
        encodeClientFrame({
          t: 'push',
          batch: 'b-1',
          ops: [
            {
              kind: 'chats',
              id: 'c1',
              op: 'upsert',
              set: { title: 'x' },
              hlc: row.clocks.title,
            },
          ],
        }),
      ).ops[0].set,
    ).toEqual({ title: 'x' });
    expect(encodeClientFrame({ t: 'probe' })).toBe('{"t":"probe"}');
  });

  it('parses server frames', () => {
    const state = parseServerFrame(
      JSON.stringify({
        t: 'state',
        seq: 4,
        full: true,
        rows: [row],
        gcFloor: 2,
      }),
    );
    expect(state).toEqual({
      t: 'state',
      seq: 4,
      full: true,
      rows: [row],
      gcFloor: 2,
    });
    expect(parseServerFrame('{"t":"rows","seq":5,"rows":[]}')).toEqual({
      t: 'rows',
      seq: 5,
      rows: [],
    });
    expect(
      parseServerFrame('{"t":"ack","batch":"b-1","seq":5,"applied":2}'),
    ).toEqual({
      t: 'ack',
      batch: 'b-1',
      seq: 5,
      applied: 2,
    });
    expect(parseServerFrame('{"t":"presence","device":"d","at":9}')).toEqual({
      t: 'presence',
      device: 'd',
      at: 9,
    });
    expect(parseServerFrame('{"t":"probe-ok","seq":5}')).toEqual({
      t: 'probe-ok',
      seq: 5,
    });
  });

  it('unknown t and malformed JSON decode to undefined, never throw', () => {
    expect(parseServerFrame('{"t":"future-frame"}')).toBeUndefined();
    expect(parseServerFrame('nonsense')).toBeUndefined();
    expect(parseServerFrame('[1]')).toBeUndefined();
    expect(parseServerFrame('"x"')).toBeUndefined();
    expect(parseServerFrame('{}')).toBeUndefined();
  });
});
