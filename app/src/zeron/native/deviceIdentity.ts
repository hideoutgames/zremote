// Device identity: a stable UUID persisted in the keychain (survives
// reinstall only while the keychain does — matches the reference iOS app's
// semantics), plus the user-visible device name.

import * as Device from 'expo-device';
import type { SecureStorePort } from '../auth/secureStore';
import { randomUUID } from './expoCrypto';

const DEVICE_ID_KEY = 'zeron.deviceId';

export const deviceId = async (store: SecureStorePort): Promise<string> => {
  const existing = await store.get(DEVICE_ID_KEY);
  if (existing !== undefined) return existing;
  const id = randomUUID();
  await store.set(DEVICE_ID_KEY, id);
  return id;
};

export const deviceName = (): string =>
  Device.deviceName ?? Device.modelName ?? 'iPhone';

export const platform = 'ios' as const;
