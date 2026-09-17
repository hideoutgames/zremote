// `SecureStorePort` over expo-secure-store. Keychain values are limited to
// ~2048 bytes — larger payloads (session-doc snapshots can exceed it) are
// chunked across `<key>__c<i>` entries with a `zeron-chunked:N` marker stored
// at the real key. KeychainAccessible: AFTER_FIRST_UNLOCK.

import * as SecureStore from 'expo-secure-store';
import type { SecureStorePort } from '../auth/secureStore';

const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
};

const CHUNK_LIMIT = 2048;
const CHUNKED_PREFIX = 'zeron-chunked:';
const chunkKey = (key: string, i: number): string => `${key}__c${i}`;

export const expoSecureStore: SecureStorePort = {
  async get(key) {
    const head = await SecureStore.getItemAsync(key, OPTIONS);
    if (head === null) return undefined;
    if (!head.startsWith(CHUNKED_PREFIX)) return head;
    const n = Number(head.slice(CHUNKED_PREFIX.length));
    if (!Number.isInteger(n) || n <= 0) return undefined;
    const parts = await Promise.all(
      Array.from({ length: n }, (_, i) =>
        SecureStore.getItemAsync(chunkKey(key, i), OPTIONS),
      ),
    );
    if (parts.some(p => p === null)) return undefined;
    return parts.join('');
  },

  async set(key, value) {
    await expoSecureStore.delete(key);
    if (value.length <= CHUNK_LIMIT) {
      await SecureStore.setItemAsync(key, value, OPTIONS);
      return;
    }
    const n = Math.ceil(value.length / CHUNK_LIMIT);
    for (let i = 0; i < n; i++) {
      await SecureStore.setItemAsync(
        chunkKey(key, i),
        value.slice(i * CHUNK_LIMIT, (i + 1) * CHUNK_LIMIT),
        OPTIONS,
      );
    }
    await SecureStore.setItemAsync(key, `${CHUNKED_PREFIX}${n}`, OPTIONS);
  },

  async delete(key) {
    const head = await SecureStore.getItemAsync(key, OPTIONS);
    if (head !== null && head.startsWith(CHUNKED_PREFIX)) {
      const n = Number(head.slice(CHUNKED_PREFIX.length));
      if (Number.isInteger(n) && n > 0) {
        for (let i = 0; i < n; i++) {
          await SecureStore.deleteItemAsync(chunkKey(key, i), OPTIONS);
        }
      }
    }
    await SecureStore.deleteItemAsync(key, OPTIONS);
  },
};
