// Crypto primitives for PKCE over expo-crypto (the auth layer injects these —
// see auth/authKit.ts). Also re-exports randomUUID for id generation.

import * as Crypto from 'expo-crypto';

export const randomBytes = (n: number): Uint8Array => Crypto.getRandomBytes(n);

export const sha256 = async (bytes: Uint8Array): Promise<Uint8Array> =>
  new Uint8Array(
    await Crypto.digest(
      Crypto.CryptoDigestAlgorithm.SHA256,
      bytes as unknown as BufferSource,
    ),
  );

export const randomUUID = (): string => Crypto.randomUUID();
