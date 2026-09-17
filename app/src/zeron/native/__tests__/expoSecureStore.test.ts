const mockBacking = new Map<string, string>();

jest.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK: 1,
  getItemAsync: jest.fn(async (k: string) => mockBacking.get(k) ?? null),
  setItemAsync: jest.fn(async (k: string, v: string) => {
    if (v.length > 2048) throw new Error('value too large');
    mockBacking.set(k, v);
  }),
  deleteItemAsync: jest.fn(async (k: string) => {
    mockBacking.delete(k);
  }),
}));

import { expoSecureStore } from '../expoSecureStore';

describe('expoSecureStore', () => {
  beforeEach(() => mockBacking.clear());

  it('round-trips small values directly', async () => {
    await expoSecureStore.set('k', 'hello');
    expect(mockBacking.get('k')).toBe('hello');
    expect(await expoSecureStore.get('k')).toBe('hello');
  });

  it('returns undefined for missing keys', async () => {
    expect(await expoSecureStore.get('missing')).toBeUndefined();
  });

  it('chunks values over the 2048-byte keychain limit', async () => {
    const big = 'x'.repeat(2048 * 3 + 17);
    await expoSecureStore.set('big', big);
    expect(mockBacking.get('big')).toBe('zeron-chunked:4');
    expect(await expoSecureStore.get('big')).toBe(big);
  });

  it('delete removes chunk entries', async () => {
    await expoSecureStore.set('big', 'y'.repeat(5000));
    await expoSecureStore.delete('big');
    expect(await expoSecureStore.get('big')).toBeUndefined();
    expect([...mockBacking.keys()].filter(k => k.includes('__c'))).toEqual([]);
  });

  it('returns undefined when a chunk is missing', async () => {
    await expoSecureStore.set('big', 'z'.repeat(5000));
    mockBacking.delete('big__c1');
    expect(await expoSecureStore.get('big')).toBeUndefined();
  });

  it('overwrite replaces an older chunked value', async () => {
    await expoSecureStore.set('big', 'q'.repeat(9000));
    await expoSecureStore.set('big', 'small');
    expect(await expoSecureStore.get('big')).toBe('small');
  });
});
