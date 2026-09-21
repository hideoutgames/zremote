// Watch session rows and the open session store. A run file opens when the
// agent is working or waiting for input, and closes when that run returns
// to idle or errored. Diffs are field-safe: command kind/status, tool kind,
// byte counts — never prompts, paths, or message text.

import { isRunFinishedFlip } from '../../notifications/runFinishedHaptic';
import type { Chat, SessionRow } from '../protocol/types';
import type { SessionState } from '../state/sessionStores';
import { getSessionStore, runPhase } from '../state/sessionStores';
import { uiPrefsStore } from '../state/uiPrefs';
import { workspaceStore } from '../state/workspaceStore';
import type { LocalLogFs } from './localLogFs';
import {
  installLocalLogWriter,
  currentLocalLogWriter,
  LocalLogWriter,
} from './localLogs';

const TERMINAL_COMMAND = new Set([
  'applied',
  'rejected',
  'expired',
  'superseded',
  'cancelled',
]);

const RUNNING = new Set(['working', 'awaitingInput']);

interface Seen {
  primed: boolean;
  phase?: string;
  room?: string;
  commands: Map<string, string>;
  tools: Map<string, string>;
  errors: Set<string>;
  context?: string;
  input?: string;
}

const freshSeen = (): Seen => ({
  primed: false,
  commands: new Map(),
  tools: new Map(),
  errors: new Set(),
});

export const observeSession = (a: {
  session: SessionState;
  row: SessionRow | undefined;
  chat: Chat | undefined;
  phoneDeviceId: string;
  now: number;
  seen: Seen;
  log: (line: string) => void;
}): void => {
  const { session, seen, log, now } = a;
  const phase = runPhase(session, a.row, a.chat, a.phoneDeviceId, now);
  if (seen.phase === undefined) log(`phase ${phase}`);
  else if (seen.phase !== phase) log(`phase ${seen.phase} -> ${phase}`);
  seen.phase = phase;

  if (seen.room === undefined) {
    if (session.room !== 'idle') log(`room ${session.room}`);
  } else if (seen.room !== session.room) {
    log(`room ${session.room}`);
  }
  seen.room = session.room;

  for (const command of session.commands) {
    const sig = `${command.kind}:${command.status}`;
    if (seen.commands.get(command.id) === sig) continue;
    const active = !TERMINAL_COMMAND.has(command.status);
    const recent = command.issuedAt >= now - 60_000;
    if (!seen.primed && !active && !recent) {
      seen.commands.set(command.id, sig);
      continue;
    }
    log(
      `command id=${command.id} kind=${command.kind} status=${command.status}`,
    );
    seen.commands.set(command.id, sig);
  }

  for (const entry of session.entries) {
    for (const part of entry.parts) {
      if (part.kind === 'tool') {
        const kind = part.call.kind;
        const sig = `${kind}|${part.resolved}|${part.isError === true}|${
          part.outputBytes ?? ''
        }|${part.subagentStatus ?? ''}`;
        if (seen.tools.get(part.id) === sig) continue;
        if (!seen.primed && part.resolved) {
          seen.tools.set(part.id, sig);
          continue;
        }
        const sub =
          part.subagentStatus !== undefined
            ? ` subagent=${part.subagentStatus}`
            : '';
        log(
          `tool id=${part.id} kind=${kind} resolved=${part.resolved} isError=${
            part.isError === true
          } outputBytes=${part.outputBytes ?? 0}${sub}`,
        );
        seen.tools.set(part.id, sig);
        continue;
      }
      if (part.kind === 'error') {
        if (seen.errors.has(part.id)) continue;
        if (seen.primed)
          log(`error part id=${part.id} len=${part.message.length}`);
        seen.errors.add(part.id);
        continue;
      }
      if (
        part.kind === 'input' &&
        !part.resolved &&
        part.questions.length > 0
      ) {
        const sig = `${part.requestId}:${part.questions.length}`;
        if (seen.input !== sig) {
          log(
            `input request=${part.requestId} questions=${part.questions.length}`,
          );
          seen.input = sig;
        }
      }
    }
  }

  const usage = session.meta.contextUsage;
  if (usage !== undefined && (usage.tokens != null || usage.window != null)) {
    const sig = `${usage.tokens ?? ''}/${usage.window ?? ''}`;
    if (seen.context !== sig) {
      // "tokens=" would be eaten by redact(); say "count" instead.
      log(`context count=${usage.tokens ?? 0} window=${usage.window ?? 0}`);
      seen.context = sig;
    }
  }

  seen.primed = true;
};

export interface BindLocalLogsDeps {
  fs: LocalLogFs;
  logsRoot: string;
  sessionMode: 'doc' | 'relay';
  phoneDeviceId: string;
  now?: () => number;
}

export const bindLocalLogs = (deps: BindLocalLogsDeps): (() => void) => {
  const writer = new LocalLogWriter({
    fs: deps.fs,
    logsRoot: deps.logsRoot,
    enabled: () => uiPrefsStore.getState().localLogsEnabled === true,
    now: deps.now,
    sessionMode: deps.sessionMode,
  });
  installLocalLogWriter(writer);

  const subs = new Map<string, () => void>();
  const seenByChat = new Map<string, Seen>();
  const lastStatus = new Map<string, string | undefined>();

  const now = (): number => deps.now?.() ?? Date.now();

  const dropSub = (chatId: string): void => {
    subs.get(chatId)?.();
    subs.delete(chatId);
    seenByChat.delete(chatId);
  };

  const ensureSub = (chatId: string): void => {
    if (subs.has(chatId)) return;
    const seen = freshSeen();
    seenByChat.set(chatId, seen);
    const tick = (): void => {
      const ws = workspaceStore.getState();
      observeSession({
        session: getSessionStore(chatId).getState(),
        row: ws.sessions[chatId],
        chat: ws.chats.find(c => c.id === chatId),
        phoneDeviceId: deps.phoneDeviceId,
        now: now(),
        seen,
        log: line => writer.append(chatId, line),
      });
    };
    tick();
    subs.set(chatId, getSessionStore(chatId).subscribe(tick));
  };

  const scan = (): void => {
    const { sessions, chats } = workspaceStore.getState();
    for (const row of Object.values(sessions)) {
      const prev = lastStatus.get(row.chatId);
      lastStatus.set(row.chatId, row.status);
      const running = RUNNING.has(row.status);
      if (running && writer.isEnabled()) {
        if (!writer.isOpen(row.chatId) && !writer.isOpening(row.chatId)) {
          ensureSub(row.chatId);
          const chat = chats.find(c => c.id === row.chatId);
          writer
            .beginRun({
              chatId: row.chatId,
              hostDeviceId: row.deviceId,
              roomGen: chat?.roomGen,
              status: row.status,
            })
            .catch(() => {});
        } else if (prev !== undefined && prev !== row.status) {
          writer.append(row.chatId, `status ${prev} -> ${row.status}`);
        }
      } else if (
        prev !== undefined &&
        isRunFinishedFlip(prev, row.status) &&
        (writer.isOpen(row.chatId) || writer.isOpening(row.chatId))
      ) {
        writer.append(row.chatId, `status ${prev} -> ${row.status}`);
        dropSub(row.chatId);
        writer.endRun(row.chatId, row.status).catch(() => {});
      }
    }
  };

  const unsubWorkspace = workspaceStore.subscribe(scan);
  const unsubPrefs = uiPrefsStore.subscribe(scan);
  scan();

  return () => {
    unsubWorkspace();
    unsubPrefs();
    for (const chatId of [...subs.keys()]) dropSub(chatId);
    if (currentLocalLogWriter() === writer) installLocalLogWriter(undefined);
  };
};
