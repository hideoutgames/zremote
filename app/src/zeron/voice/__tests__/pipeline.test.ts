import { LocalVoiceSession } from '../pipeline';
import { CLEANUP_WATCHDOG_MS } from '../types';
import type {
  CleanupEngine,
  TranscriptionEngine,
  VoiceCapturePort,
  VoiceNotice,
  VoicePipelineStage,
} from '../types';

const waitFor = async (pred: () => boolean, label: string): Promise<void> => {
  for (let i = 0; i < 50; i += 1) {
    if (pred()) return;
    await Promise.resolve();
  }
  throw new Error(`timeout waiting for ${label}`);
};

const capture = (uri = 'file://rec.wav'): VoiceCapturePort => ({
  start: jest.fn(async () => {}),
  stop: jest.fn(async () => ({ uri, durationMs: 1200 })),
  cancel: jest.fn(async () => {}),
});

const transcription = (text = 'um open the settings'): TranscriptionEngine => ({
  isAvailable: async () => true,
  transcribe: jest.fn(async () => ({ text })),
  unload: jest.fn(async () => {}),
  abort: jest.fn(async () => {}),
});

const cleanup = (text = 'open the settings'): CleanupEngine => ({
  supportsCustomPrompt: true,
  isAvailable: async () => true,
  clean: jest.fn(async req => {
    expect(req.transcript).toBe('um open the settings');
    expect(req.systemPrompt.length).toBeGreaterThan(40);
    return { text };
  }),
  unload: jest.fn(async () => {}),
  abort: jest.fn(async () => {}),
});

const setup = (opts?: {
  transcript?: string;
  cleaned?: string;
  cleanupEngine?: CleanupEngine | undefined;
  cleanupPath?: string;
}) => {
  let draft = 'prefix ';
  const stages: VoicePipelineStage[] = [];
  const notices: Array<VoiceNotice | null> = [];
  const deleted: string[] = [];
  const cap = capture();
  const stt = transcription(opts?.transcript);
  const cln =
    opts?.cleanupEngine === undefined
      ? cleanup(opts?.cleaned)
      : opts.cleanupEngine;
  const session = new LocalVoiceSession({
    chatId: 'c1',
    getDraft: () => draft,
    setDraft: t => {
      draft = t;
    },
    getSelection: () => draft.length,
    capture: cap,
    transcription: stt,
    cleanup: cln,
    transcriptionPath: '/models/tiny.bin',
    cleanupPath: opts?.cleanupPath ?? '/models/qwen.bin',
    onStage: s => stages.push(s),
    onNotice: n => notices.push(n),
    deleteAudio: async uri => {
      deleted.push(uri);
    },
  });
  return {
    session,
    stages,
    notices,
    getDraft: () => draft,
    cap,
    stt,
    cln,
    deleted,
  };
};

test('cleanup disabled inserts raw transcript and idles', async () => {
  const { session, stages, getDraft, deleted } = setup({
    cleanupEngine: undefined,
    cleanupPath: '',
  });
  await session.start();
  await session.stop();
  expect(getDraft()).toBe('prefix um open the settings');
  expect(stages).toEqual(['preparing', 'recording', 'transcribing', 'idle']);
  expect(deleted).toEqual(['file://rec.wav']);
});

test('cleanup success replaces only the voice span', async () => {
  const { session, getDraft, notices, stages, cln } = setup();
  await session.start();
  await session.stop();
  expect(getDraft()).toBe('prefix open the settings');
  expect(notices.some(n => n?.kind === 'restore')).toBe(true);
  expect(stages).toContain('cleaning');
  expect(cln.clean).toHaveBeenCalledTimes(1);
});

test('invalid cleanup output keeps the raw transcript', async () => {
  const { session, getDraft, notices } = setup({
    cleaned: 'please open preferences instead',
  });
  await session.start();
  await session.stop();
  expect(getDraft()).toBe('prefix um open the settings');
  expect(notices.some(n => n?.kind === 'cleanupFailed')).toBe(true);
});

test('user edits during cleanup cancel the replacement', async () => {
  let draft = 'prefix ';
  let resumeClean: (v: { text: string }) => void = () => {};
  const session = new LocalVoiceSession({
    chatId: 'c1',
    getDraft: () => draft,
    setDraft: t => {
      draft = t;
    },
    getSelection: () => draft.length,
    capture: capture(),
    transcription: transcription(),
    cleanup: {
      supportsCustomPrompt: true,
      isAvailable: async () => true,
      clean: () =>
        new Promise(resolve => {
          resumeClean = resolve;
        }),
      unload: async () => {},
      abort: async () => {},
    },
    transcriptionPath: '/m.bin',
    cleanupPath: '/c.bin',
    onStage: () => {},
    onNotice: () => {},
  });
  await session.start();
  const stopping = session.stop();
  await waitFor(() => session.currentStage() === 'cleaning', 'cleaning');
  draft = 'prefix UM open the settings';
  resumeClean({ text: 'open the settings' });
  await stopping;
  expect(draft).toBe('prefix UM open the settings');
});

test('late callbacks after cancel do not write', async () => {
  let draft = '';
  let resumeStop: (v: { uri: string; durationMs: number }) => void = () => {};
  const session = new LocalVoiceSession({
    chatId: 'c1',
    getDraft: () => draft,
    setDraft: t => {
      draft = t;
    },
    getSelection: () => 0,
    capture: {
      start: async () => {},
      stop: () =>
        new Promise(resolve => {
          resumeStop = resolve;
        }),
      cancel: async () => {},
    },
    transcription: transcription('should not land'),
    transcriptionPath: '/m.bin',
    onStage: () => {},
    onNotice: () => {},
  });
  await session.start();
  const stopping = session.stop();
  session.invalidate();
  resumeStop({ uri: 'file://late.wav', durationMs: 10 });
  await stopping;
  expect(draft).toBe('');
});

test('watchdog during cleanup keeps raw text', async () => {
  jest.useFakeTimers();
  const { session, getDraft, notices } = setup({
    cleanupEngine: {
      supportsCustomPrompt: true,
      isAvailable: async () => true,
      clean: () => new Promise(() => {}),
      unload: async () => {},
      abort: jest.fn(async () => {}),
    },
  });
  await session.start();
  const stopping = session.stop();
  await waitFor(() => session.currentStage() === 'cleaning', 'cleaning');
  jest.advanceTimersByTime(CLEANUP_WATCHDOG_MS);
  await stopping.catch(() => {});
  expect(getDraft()).toBe('prefix um open the settings');
  expect(notices.some(n => n?.kind === 'cleanupFailed')).toBe(true);
  jest.useRealTimers();
});

test('missing model is reported without starting capture', async () => {
  const cap = capture();
  const session = new LocalVoiceSession({
    chatId: 'c1',
    getDraft: () => '',
    setDraft: () => {},
    getSelection: () => 0,
    capture: cap,
    transcription: transcription(),
    transcriptionPath: '',
    onStage: () => {},
    onNotice: () => {},
  });
  await expect(session.start()).resolves.toBe('missingModel');
  expect(cap.start).not.toHaveBeenCalled();
});

test('inserts at the caret captured when recording started', async () => {
  let draft = 'ab';
  let selection = 1;
  const session = new LocalVoiceSession({
    chatId: 'c1',
    getDraft: () => draft,
    setDraft: t => {
      draft = t;
    },
    getSelection: () => selection,
    capture: capture(),
    transcription: transcription('X'),
    transcriptionPath: '/m.bin',
    cleanupPath: '',
    onStage: () => {},
    onNotice: () => {},
  });
  await session.start();
  selection = 2;
  await session.stop();
  expect(draft).toBe('aXb');
});

test('over-limit transcripts skip cleanup without truncating', async () => {
  const raw = 'word '.repeat(1_000).trim();
  const cln = cleanup('should not run');
  const { session, getDraft } = setup({
    transcript: raw,
    cleanupEngine: cln,
  });
  await session.start();
  await session.stop();
  expect(getDraft()).toBe(`prefix ${raw}`);
  expect(cln.clean).not.toHaveBeenCalled();
});

test('cancel processing after transcription keeps raw text', async () => {
  let resumeClean: (v: { text: string }) => void = () => {};
  let draft = '';
  const session = new LocalVoiceSession({
    chatId: 'c1',
    getDraft: () => draft,
    setDraft: t => {
      draft = t;
    },
    getSelection: () => draft.length,
    capture: capture(),
    transcription: transcription(),
    cleanup: {
      supportsCustomPrompt: true,
      isAvailable: async () => true,
      clean: () =>
        new Promise(resolve => {
          resumeClean = resolve;
        }),
      unload: async () => {},
      abort: async () => {},
    },
    transcriptionPath: '/m.bin',
    cleanupPath: '/c.bin',
    onStage: () => {},
    onNotice: () => {},
  });
  await session.start();
  const stopping = session.stop();
  await waitFor(() => session.currentStage() === 'cleaning', 'cleaning');
  expect(draft).toBe('um open the settings');
  await session.cancelProcessing();
  resumeClean({ text: 'open the settings' });
  await stopping;
  expect(draft).toBe('um open the settings');
});
