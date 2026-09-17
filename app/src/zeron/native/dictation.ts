// Dictation port — the native speech module lands in a later stage; the
// composer binds to this surface so the button logic, partial/final text
// handling, and lifecycle stops are testable now.

export interface DictationCallbacks {
  onPartial: (text: string) => void;
  onFinal: (text: string) => void;
  onError: (err: Error) => void;
}

export interface DictationPort {
  isSupported(): Promise<{
    supported: boolean;
    onDevice: boolean;
    reason?: string;
  }>;
  start(opts: { locale?: string }, cb: DictationCallbacks): Promise<void>;
  stop(): Promise<void>;
  cancel(): Promise<void>;
}

export const dictationUnavailable: DictationPort = {
  isSupported: () =>
    Promise.resolve({
      supported: false,
      onDevice: false,
      reason: 'native module not built',
    }),
  start: () => Promise.reject(new Error('dictation unavailable')),
  stop: () => Promise.resolve(),
  cancel: () => Promise.resolve(),
};
