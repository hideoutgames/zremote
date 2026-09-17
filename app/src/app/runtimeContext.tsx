// Runtime/auth context: ZeronApp owns the AuthSession and the per-account
// AppRuntime; screens consume them here. `runtime` is null while the account
// scope is being hydrated.

import { createContext, useContext } from 'react';
import type { AuthSession } from '../zeron/auth/authSession';
import type { AppRuntime } from '../zeron/runtime/appRuntime';

export interface AppServices {
  auth: AuthSession;
  runtime: AppRuntime | null;
  /** zeron://session/{chatId} deep links land here. */
  openSession: (chatId: string) => void;
  /** Full stop + account cache wipe (explicit sign-out only). */
  signOut: () => Promise<void>;
}

export const AppServicesContext = createContext<AppServices | null>(null);

export const useAppServices = (): AppServices => {
  const s = useContext(AppServicesContext);
  if (s === null) throw new Error('AppServices not mounted');
  return s;
};

/** Null until the account-scoped runtime exists. */
export const useRuntime = (): AppRuntime | null => useAppServices().runtime;

export const useAuthSession = (): AuthSession => useAppServices().auth;
