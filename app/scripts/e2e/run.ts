// Stage-3 E2E orchestrator (zeron@853872d scenario, cf. scripts/e2e-smoke.sh):
// our TypeScript client acts as the phone against a real `wrangler dev` edge
// and the real zeron.exe engine (mock harness). Stops on the first failure
// but always writes .e2e/report.md and preserves .e2e/logs/.

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  buildArchivedSet,
  buildCreateChatSet,
  buildMarkSeenSet,
  buildRenameSet,
} from '../../src/zeron/doc/workspaceProjection';
import {
  buildInterrupt,
  buildRespondInput,
  buildRunCommand,
  buildSteer,
  newId,
} from '../../src/zeron/doc/sessionDoc';
import { METHODS } from '../../src/zeron/protocol/rpc';
import type { FieldValue } from '../../src/zeron/protocol/registryCore';
import type { EdgeConfig } from '../../src/zeron/transport/edge';
import { PhonePeer, type PhoneSession } from './phone';
import {
  ensureLogDir,
  killProc,
  startEdge,
  startEngine,
  tailFile,
  waitFor,
  type EngineOptions,
  type ProcPaths,
  type RunningProc,
} from './procs';
import { Report } from './report';

const APP_DIR = resolve(__dirname, '..', '..');
const REF_ROOT = resolve(APP_DIR, '..', '..', '_ref');
const PATHS: ProcPaths = {
  repoRoot: APP_DIR,
  edgeDir: join(REF_ROOT, 'zeron', 'edge'),
  engineBin: join(REF_ROOT, 'zeron-bin', 'zeron.exe'),
  e2eDir: join(APP_DIR, '.e2e'),
  logDir: '',
};
PATHS.logDir = ensureLogDir(PATHS.e2eDir);
const SPACE_DIR = join(REF_ROOT, 'e2e-space');

const EDGE_PORT = 27640;
const EDGE_URL = `http://localhost:${EDGE_PORT}`;
const CFG: EdgeConfig = { baseUrl: EDGE_URL };
const ORG = 'org1';
const IPC_PORT = 27801;
const WAIT = 90_000;

const logLines: string[] = [];
const log = (line: string): void => {
  logLines.push(line);
  console.log(`  ${line}`);
};

interface EngineCtl {
  current?: RunningProc;
  index: number;
  dataDir: string;
  restart(extra: Partial<EngineOptions>): Promise<RunningProc>;
}

const makeEngineCtl = (): EngineCtl => ({
  current: undefined,
  index: 0,
  dataDir: mkdtempSync(join(tmpdir(), 'zeron-e2e-data-')),
  async restart(extra) {
    killProc(this.current);
    this.index += 1;
    this.current = await startEngine(PATHS, {
      ipcPort: IPC_PORT,
      deviceName: 'e2e-host',
      edgeUrl: EDGE_URL,
      token: `alice@${ORG}`,
      orgId: ORG,
      dataDir: this.dataDir,
      ...extra,
    });
    return this.current;
  },
});

/** Wait for the host's `devices` row (doubles as engine readiness). */
const waitForHostRow = async (phone: PhonePeer) =>
  waitFor(
    'engine devices row',
    () => {
      const w = phone.workspace();
      const host = w.devices.find(d => d.name === 'e2e-host');
      return host !== undefined &&
        host.version !== undefined &&
        host.capabilities.length > 0
        ? host
        : undefined;
    },
    WAIT,
  );

/** Collect session statuses while awaiting `done`. */
const watchStatuses = async <T>(
  phone: PhonePeer,
  chatId: string,
  seen: string[],
  done: () => Promise<T>,
): Promise<T> => {
  const timer = setInterval(() => {
    const s = phone.workspace().sessions[chatId]?.status;
    if (s !== undefined && seen[seen.length - 1] !== s) seen.push(s);
  }, 100);
  try {
    return await done();
  } finally {
    clearInterval(timer);
  }
};

const main = async (): Promise<number> => {
  const report = new Report();
  let edge: { proc?: RunningProc; weStarted: boolean } | undefined;
  const engine = makeEngineCtl();
  let phone1: PhonePeer | undefined;
  let phone2: PhonePeer | undefined;
  let hostDeviceId = '';
  let spaceId = '';
  let chatId = '';
  let session1: PhoneSession | undefined;

  try {
    // ── Step 1: edge + engine up; registry observes the device row ──────
    await report.step('1. edge+engine startup, device row', async () => {
      edge = await startEdge(PATHS, EDGE_PORT, log);
      await engine.restart({});
      phone1 = new PhonePeer({
        cfg: CFG,
        orgId: ORG,
        deviceId: newId(),
        userId: 'alice',
        log,
      });
      phone1.start();
      const host = await waitForHostRow(phone1);
      hostDeviceId = host.id;
      phone1.relayTo(hostDeviceId);
      report.section('step1 device row', host);
      return `device ${host.id.slice(0, 8)} v${
        host.version
      } caps=${host.capabilities.join(',')}`;
    });

    // ── Step 2: relay RPC catalog ───────────────────────────────────────
    await report.step('2. relay RPC catalog', async () => {
      const harnesses = await phone1!.callHost<unknown>(
        METHODS.LIST_HARNESSES,
        {},
      );
      report.section('step2 ListHarnesses', harnesses);
      const hasMock = JSON.stringify(harnesses).includes('"mock"');
      if (!hasMock) throw new Error('mock harness not in ListHarnesses');
      const models = await phone1!.callHost<unknown>(METHODS.LIST_MODELS, {
        harness: 'mock',
      });
      report.section('step2 ListModels mock', models);
      const folders = await phone1!.callHost<{ entries?: unknown[] }>(
        METHODS.LIST_FOLDERS,
        {},
      );
      report.section('step2 ListFolders home', folders);
      if ((folders.entries?.length ?? 0) === 0)
        throw new Error('ListFolders home listing empty');
      return `mock present; folders=${folders.entries?.length ?? 0}`;
    });

    // ── Step 3: create space via Mutate over the relay ─────────────────
    await report.step('3. createSpace via Mutate', async () => {
      mkdirSync(SPACE_DIR, { recursive: true });
      try {
        execFileSync('git', ['init'], { cwd: SPACE_DIR, stdio: 'ignore' });
      } catch {
        log('git not available; space will not be a repo');
      }
      spaceId = newId();
      const params = {
        op: 'createSpace',
        spaceId,
        deviceId: hostDeviceId,
        path: SPACE_DIR,
        name: 'e2e-space',
        gitDetected: false,
      };
      const res = await phone1!.callHost<unknown>(METHODS.MUTATE, params);
      report.section('step3 Mutate createSpace params', params);
      report.section('step3 Mutate createSpace result', res);
      report.section(
        'step3 Mutate param shapes (from crates/engine/src/rpc.rs)',
        {
          createChat:
            '{op:"createChat", chatId, spaceId?, deviceId, config?, branch?, cwd?}',
          renameChat: '{op:"renameChat", chatId, title}',
          setChatArchived: '{op:"setChatArchived", chatId, archived}',
          deleteChat: '{op:"deleteChat", chatId}',
          markChatSeen: '{op:"markChatSeen", chatId, at}',
        },
      );
      const space = await waitFor(
        'spaces row',
        () =>
          phone1!
            .workspace()
            .spaces.find(s => s.id === spaceId || s.path === SPACE_DIR),
        WAIT,
      );
      report.section('step3 space row', space);
      return `space ${space.id.slice(0, 8)} gitDetected=${space.gitDetected}`;
    });

    // ── Step 4: create chat via registry upsert ─────────────────────────
    await report.step('4. createChat via registry', async () => {
      const create = buildCreateChatSet({
        deviceId: hostDeviceId,
        spaceId,
        cwd: SPACE_DIR,
        config: { harness: 'mock', modelOptions: {} },
        nowMs: Date.now(),
      });
      chatId = create.chatId;
      report.section('step4 createChat set', create);
      phone1!.registryDoc.write(create.kind, create.id, create.op, create.set);
      phone1!.registry.flushPending();
      await waitFor(
        'registry ack of createChat',
        () => (phone1!.registryDoc.pendingCount === 0 ? true : undefined),
        WAIT,
      );
      const chat = phone1!.workspace().chats.find(c => c.id === chatId);
      report.section('step4 chat row', chat);
      return `chat ${chatId.slice(0, 8)}`;
    });

    // ── Step 5: run command → complete transcript ───────────────────────
    await report.step('5. run command to completion', async () => {
      session1 = phone1!.openChat(chatId);
      session1.start();
      const runPayload = buildRunCommand('hello from the phone', {
        config: { harness: 'mock' },
        cwd: SPACE_DIR,
      });
      const messageId = runPayload.kind === 'run' ? runPayload.messageId : '';
      const cursorBefore = session1.cursor;
      const commandId = await phone1!.commandAndNudge(session1, runPayload);
      const statuses: string[] = [];
      await watchStatuses(phone1!, chatId, statuses, async () => {
        await session1!.waitForAck(cursorBefore, WAIT);
        await waitFor(
          'user message entry',
          () =>
            session1!
              .project()
              ?.entries.find(e => e.id === messageId && e.role === 'user'),
          WAIT,
        );
        await waitFor(
          'assistant entry complete',
          () =>
            session1!
              .project()
              ?.entries.find(
                e => e.role === 'assistant' && e.status === 'complete',
              ),
          WAIT,
        );
        await waitFor(
          'run command applied',
          () =>
            session1!
              .project()
              ?.commands.find(
                c => c.id === commandId && c.status === 'applied',
              ),
          WAIT,
        );
        await waitFor(
          'session back to idle',
          () =>
            phone1!.workspace().sessions[chatId]?.status === 'idle'
              ? true
              : undefined,
          WAIT,
        );
      });
      const proj = session1.project();
      report.section('step5 transcript', proj?.entries);
      report.section('step5 commands', proj?.commands);
      return `statuses=${statuses.join('→')} entries=${proj?.entries.length}`;
    });

    // ── Step 6: interrupt ───────────────────────────────────────────────
    await report.step('6. interrupt mid-run', async () => {
      await engine.restart({ mockDelayMs: 1500 });
      await waitForHostRow(phone1!);
      const statuses: string[] = [];
      const idsBefore = new Set(
        session1!.project()?.entries.map(e => e.id) ?? [],
      );
      await watchStatuses(phone1!, chatId, statuses, async () => {
        const runPayload = buildRunCommand('interrupt me', {
          config: { harness: 'mock' },
          cwd: SPACE_DIR,
        });
        const runId = await phone1!.commandAndNudge(session1!, runPayload);
        await waitFor(
          'session working',
          () =>
            phone1!.workspace().sessions[chatId]?.status === 'working'
              ? true
              : undefined,
          WAIT,
        );
        const lastEntry = session1!.project()?.entries.at(-1);
        const interruptId = await phone1!.commandAndNudge(
          session1!,
          buildInterrupt(),
          lastEntry?.id,
        );
        const terminal = await waitFor(
          'assistant entry terminal status',
          () =>
            session1!
              .project()
              ?.entries.find(
                x =>
                  x.role === 'assistant' &&
                  !idsBefore.has(x.id) &&
                  x.status !== undefined &&
                  x.status !== 'streaming',
              ),
          WAIT,
        );
        await waitFor(
          'interrupt applied',
          () =>
            session1!
              .project()
              ?.commands.find(
                c => c.id === interruptId && c.status === 'applied',
              ),
          WAIT,
        );
        await waitFor(
          'session idle after interrupt',
          () =>
            phone1!.workspace().sessions[chatId]?.status === 'idle'
              ? true
              : undefined,
          WAIT,
        );
        report.section('step6 interrupt result', {
          runId,
          interruptId,
          terminalStatus: terminal.status,
          statuses,
        });
      });
      return `statuses=${statuses.join('→')}`;
    });

    // ── Step 7: question/approval ───────────────────────────────────────
    await report.step('7. question/approval', async () => {
      await engine.restart({ mockDelayMs: 300, mockQuestion: true });
      await waitForHostRow(phone1!);
      const runPayload = buildRunCommand('ask me things', {
        config: { harness: 'mock' },
        cwd: SPACE_DIR,
      });
      await phone1!.commandAndNudge(session1!, runPayload);
      const inputPart = await waitFor(
        'unresolved input part',
        () =>
          session1!
            .project()
            ?.entries.flatMap(e => e.parts)
            .find(p => p.kind === 'input' && !p.resolved),
        WAIT,
      );
      report.section('step7 input part', inputPart);
      await waitFor(
        'session awaitingInput',
        () =>
          phone1!.workspace().sessions[chatId]?.status === 'awaitingInput'
            ? true
            : undefined,
        WAIT,
      );
      if (inputPart.kind !== 'input')
        throw new Error('input part missing requestId');
      const answers = inputPart.questions.map(q => ({
        questionId: q.id,
        labels: [q.options[0] ?? 'yes'],
      }));
      report.section('step7 respondInput answers', answers);
      await phone1!.commandAndNudge(
        session1!,
        buildRespondInput(inputPart.requestId, answers),
      );
      await waitFor(
        'questions resolved + run complete',
        () => {
          const proj = session1!.project();
          const resolved = proj?.entries
            .flatMap(e => e.parts)
            .find(p => p.kind === 'input' && p.resolved);
          const done = proj?.entries.some(
            e => e.role === 'assistant' && e.status === 'complete',
          );
          return resolved !== undefined && done ? true : undefined;
        },
        WAIT,
      );
      return 'questions resolved, run completed';
    });

    // ── Step 8: reconnect/replay ────────────────────────────────────────
    await report.step('8. reconnect/replay', async () => {
      await engine.restart({ mockDelayMs: 500 });
      await waitForHostRow(phone1!);
      // Phone #1 goes dark: persist snapshot+cursor, drop the room.
      const persisted = session1!.persist();
      const idsBefore = new Set(
        session1!.project()?.entries.map(e => e.id) ?? [],
      );
      session1!.stop();
      // Phone #2 queues a run while #1 is dark.
      phone2 = new PhonePeer({
        cfg: CFG,
        orgId: ORG,
        deviceId: newId(),
        userId: 'alice',
        log,
      });
      phone2.start();
      await waitForHostRow(phone2);
      phone2.relayTo(hostDeviceId);
      const session2 = phone2.openChat(chatId);
      session2.start();
      const runPayload = buildRunCommand('while you were away', {
        config: { harness: 'mock' },
        cwd: SPACE_DIR,
      });
      await phone2.commandAndNudge(session2, runPayload);
      await waitFor(
        'phone2 sees a new assistant entry',
        () =>
          session2
            .project()
            ?.entries.find(e => e.role === 'assistant' && !idsBefore.has(e.id)),
        WAIT,
      );
      // Phone #1 rehydrates a FRESH SessionDoc from the persisted state.
      const session1b = phone1!.openChat(chatId, persisted);
      session1b.start();
      session1 = session1b;
      await waitFor(
        'phone1 projection == phone2 projection',
        () => {
          const p1 = session1b.project()?.entries.map(e => e.id) ?? [];
          const p2 = session2.project()?.entries.map(e => e.id) ?? [];
          if (p1.length !== p2.length) return undefined;
          const s1 = new Set(p1);
          if (s1.size !== p1.length) return undefined;
          return p2.every(id => s1.has(id)) ? true : undefined;
        },
        WAIT,
      );
      report.section('step8 phone1 entries', session1b.project()?.entries);
      return 'projections equal after rehydrate';
    });

    // ── Step 9: steer ───────────────────────────────────────────────────
    await report.step('9. steer mid-run', async () => {
      const runPayload = buildRunCommand('long delayed run', {
        config: { harness: 'mock' },
        cwd: SPACE_DIR,
      });
      await phone1!.commandAndNudge(session1!, runPayload);
      await waitFor(
        'session working for steer',
        () =>
          phone1!.workspace().sessions[chatId]?.status === 'working'
            ? true
            : undefined,
        WAIT,
      );
      const steerId = await phone1!.commandAndNudge(
        session1!,
        buildSteer('course correct mid-run'),
      );
      const cmd = await waitFor(
        'steer terminal status',
        () =>
          session1!
            .project()
            ?.commands.find(c => c.id === steerId && c.status !== 'pending'),
        WAIT,
      );
      report.section('step9 steer command', cmd);
      return `steer terminal status: ${cmd.status}`;
    });

    // ── Step 10: registry mutations ─────────────────────────────────────
    await report.step('10. registry mutations converge', async () => {
      const mutate = async (
        label: string,
        set: Record<string, FieldValue | null>,
        check: () => boolean,
      ) => {
        phone1!.registryDoc.write('chats', chatId, 'upsert', set);
        phone1!.registry.flushPending();
        await waitFor(
          `${label} ack`,
          () => (phone1!.registryDoc.pendingCount === 0 ? true : undefined),
          WAIT,
        );
        await waitFor(
          `${label} converged`,
          () => (check() ? true : undefined),
          WAIT,
        );
      };
      const chatRow = () =>
        phone1!.workspace().chats.find(c => c.id === chatId);
      await mutate(
        'rename',
        buildRenameSet('e2e renamed chat'),
        () => chatRow()?.title === 'e2e renamed chat',
      );
      await mutate(
        'archive',
        buildArchivedSet(true),
        () => chatRow()?.archived === true,
      );
      await mutate(
        'unarchive',
        buildArchivedSet(false),
        () => chatRow()?.archived === false,
      );
      const seenAt = Date.now();
      await mutate(
        'markSeen',
        buildMarkSeenSet(seenAt),
        () => (chatRow()?.lastSeenAt ?? 0) >= seenAt - 5000,
      );
      report.section('step10 final chat row', chatRow());
      return 'rename/archive/unarchive/markSeen converged';
    });
  } finally {
    phone1?.stop();
    phone2?.stop();
    killProc(engine.current);
    if (edge?.weStarted) killProc(edge.proc);
    const tails = [
      { label: 'phone harness', tail: logLines.slice(-60).join('\n') },
    ];
    if (engine.current !== undefined)
      tails.push({ label: 'engine', tail: tailFile(engine.current.logPath) });
    if (edge?.proc !== undefined)
      tails.push({ label: 'edge', tail: tailFile(edge.proc.logPath, 25) });
    report.write(join(PATHS.e2eDir, 'report.md'), tails);
  }
  return report.failed ? 1 : 0;
};

main()
  .then(code => process.exit(code))
  .catch(e => {
    console.error(`e2e aborted: ${String(e)}`);
    process.exit(1);
  });
