// Ported from zeron@853872d apps/ios/Zeron/Models/Entities.swift derived
// logic (effectiveStatus, chatIndicator, sortActive, chatUnseen,
// versionTriple, deviceSupports) — vectors mirror crates/ui/src/state.rs
// usage and the enum's documented precedence order.

import {
  chatIndicator,
  chatUnseen,
  deviceSupports,
  deviceVersionAtLeast,
  displayTitle,
  effectiveStatus,
  SESSION_STALE_MS,
  sortActive,
  spaceDisplayName,
  versionTriple,
} from '../entities';
import {
  EngineCapability,
  type Chat as ChatT,
  type SessionRow,
} from '../types';

const session = (
  status: SessionRow['status'],
  updatedAt: number,
): SessionRow => ({
  chatId: 'c',
  deviceId: 'd',
  status,
  updatedAt,
});

const chat = (over: Partial<ChatT> = {}): ChatT => ({
  id: 'c1',
  deviceId: 'd1',
  archived: false,
  createdAt: 1,
  ...over,
});

describe('effectiveStatus', () => {
  it('stale working/awaitingInput rows read as no-live-status', () => {
    const now = 100_000;
    expect(
      effectiveStatus(session('working', now - SESSION_STALE_MS - 1), now),
    ).toBeUndefined();
    expect(
      effectiveStatus(session('working', now - SESSION_STALE_MS + 1), now),
    ).toBe('working');
    expect(effectiveStatus(session('awaitingInput', now), now)).toBe(
      'awaitingInput',
    );
    // idle/errored never go stale; missing rows are undefined.
    expect(effectiveStatus(session('errored', 0), now)).toBe('errored');
    expect(effectiveStatus(session('idle', 0), now)).toBe('idle');
    expect(effectiveStatus(undefined, now)).toBeUndefined();
  });
});

describe('chatIndicator', () => {
  it('live working/awaitingInput win; errored only when unseen', () => {
    const unseen = chat({ lastMessageAt: 10, lastSeenAt: 5 });
    const seen = chat({ lastMessageAt: 5, lastSeenAt: 10 });
    expect(chatIndicator(chat(), 'working')).toBe('working');
    expect(chatIndicator(chat(), 'awaitingInput')).toBe('awaitingInput');
    expect(chatIndicator(unseen, 'errored')).toBe('errored');
    expect(chatIndicator(seen, 'errored')).toBe('idle');
    expect(chatIndicator(unseen, 'idle')).toBe('completed');
    expect(chatIndicator(unseen, undefined)).toBe('completed');
    expect(chatIndicator(seen, 'idle')).toBe('idle');
  });
});

describe('sortActive', () => {
  it('orders by lastMessageAt ?? createdAt desc, id tiebreak', () => {
    const a = chat({ id: 'a', lastMessageAt: 5 });
    const b = chat({ id: 'b', lastMessageAt: 9 });
    const c = chat({ id: 'c', createdAt: 50 });
    const d = chat({ id: 'd', createdAt: 10 });
    const e = chat({ id: 'e', lastMessageAt: 9 });
    expect(sortActive([a, d, b, c, e]).map(x => x.id)).toEqual([
      'c',
      'd',
      'b',
      'e',
      'a',
    ]);
  });
});

describe('chatUnseen / displayTitle / spaceDisplayName', () => {
  it('unseen when a message arrived after the last seen mark', () => {
    expect(chatUnseen(chat({ lastMessageAt: 10, lastSeenAt: 5 }))).toBe(true);
    expect(chatUnseen(chat({ lastMessageAt: 5, lastSeenAt: 10 }))).toBe(false);
    expect(chatUnseen(chat({ lastMessageAt: 10 }))).toBe(true); // never seen
    expect(chatUnseen(chat({ lastSeenAt: 0 }))).toBe(false); // no messages
  });

  it('displayTitle falls back to "New session"', () => {
    expect(displayTitle(chat({ title: 'Named' }))).toBe('Named');
    expect(displayTitle(chat({ title: '' }))).toBe('New session');
    expect(displayTitle(chat({}))).toBe('New session');
  });

  it('spaceDisplayName prefers name, then path basename', () => {
    expect(
      spaceDisplayName({
        id: 's',
        deviceId: 'd',
        path: '/x',
        name: 'Work',
        gitDetected: false,
        createdAt: 0,
      }),
    ).toBe('Work');
    expect(
      spaceDisplayName({
        id: 's',
        deviceId: 'd',
        path: '/x/my-repo/',
        gitDetected: true,
        createdAt: 0,
      }),
    ).toBe('my-repo');
  });
});

describe('version / capabilities', () => {
  it('versionTriple parses major.minor.patch, tolerating -suffix/+build', () => {
    expect(versionTriple('0.2.72')).toEqual([0, 2, 72]);
    expect(versionTriple('0.2.72-rc.1')).toEqual([0, 2, 72]);
    expect(versionTriple('12.300.4+build9')).toEqual([12, 300, 4]);
    expect(versionTriple('1.2')).toBeUndefined();
    expect(versionTriple('1.2.x')).toBeUndefined();
    expect(versionTriple('1.2.3.4')).toBeUndefined();
    expect(versionTriple('')).toBeUndefined();
  });

  it('deviceSupports and deviceVersionAtLeast', () => {
    const dev = {
      id: 'd',
      name: 'd',
      platform: 'macos',
      capabilities: [
        EngineCapability.messageQueueV1,
        EngineCapability.messageQueueEditLeaseV1,
      ],
      version: '0.2.72',
    };
    expect(deviceSupports(dev, EngineCapability.messageQueueV1)).toBe(true);
    expect(
      deviceSupports(dev, EngineCapability.messageQueueAttachmentsV1),
    ).toBe(false);
    expect(deviceSupports(undefined, EngineCapability.messageQueueV1)).toBe(
      false,
    );
    expect(deviceVersionAtLeast(dev, [0, 2, 72])).toBe(true);
    expect(deviceVersionAtLeast(dev, [0, 3, 0])).toBe(false);
    expect(
      deviceVersionAtLeast({ ...dev, version: undefined }, [0, 0, 1]),
    ).toBe(false);
  });
});
