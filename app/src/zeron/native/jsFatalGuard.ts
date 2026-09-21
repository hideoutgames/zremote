// Release builds report JS fatals to RCTExceptionsManager → RCTFatal →
// SIGABRT (the TestFlight login/thread dumps). Keep the process alive and
// log only the error name — never message text (may contain prompts).

import { createLog } from '../log';

const log = createLog();

type FatalUtils = {
  getGlobalHandler(): (error: unknown, isFatal?: boolean) => void;
  setGlobalHandler(cb: (error: unknown, isFatal?: boolean) => void): void;
};

const fatalUtils = (): FatalUtils | undefined => {
  const g = globalThis as typeof globalThis & { ErrorUtils?: FatalUtils };
  return g.ErrorUtils;
};

export const installJsFatalGuard = (): void => {
  const eu = fatalUtils();
  if (eu === undefined) return;
  const previous = eu.getGlobalHandler();
  eu.setGlobalHandler((error, isFatal) => {
    const name = error instanceof Error ? error.name : 'Error';
    log.error(`js ${isFatal === true ? 'fatal' : 'error'} (${name})`);
    if (__DEV__) previous(error, isFatal);
  });
};
