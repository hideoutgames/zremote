// Stage-3 E2E process orchestration: spawn/await/kill the `wrangler dev`
// edge and the Zeron engine binary, with log capture under .e2e/logs/.
// Mirrors scripts/e2e-smoke.sh (zeron@853872d) — a healthy pre-existing edge
// is reused and left running.

import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import {
  createWriteStream,
  mkdirSync,
  existsSync,
  readFileSync,
} from 'node:fs';
import { join } from 'node:path';

export interface ProcPaths {
  repoRoot: string;
  edgeDir: string;
  engineBin: string;
  e2eDir: string;
  logDir: string;
}

export interface EngineOptions {
  ipcPort: number;
  deviceName: string;
  edgeUrl: string;
  token: string;
  orgId: string;
  /** Stable across restarts so the engine keeps its device identity. */
  dataDir: string;
  mockDelayMs?: number;
  mockQuestion?: boolean;
  mockChars?: number;
  extraEnv?: Record<string, string>;
}

export interface RunningProc {
  proc: ChildProcess;
  logPath: string;
  label: string;
}

const sleep = (ms: number): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, ms));

export const tailFile = (path: string, lines = 40): string => {
  if (!existsSync(path)) return '(no log file)';
  const content = readFileSync(path, 'utf8');
  const split = content.split(/\r?\n/);
  return split.slice(Math.max(0, split.length - lines)).join('\n');
};

/** GET /health and report whether the body carries `"auth":"dev"`. */
export const edgeHealthy = async (edgeUrl: string): Promise<boolean> => {
  try {
    const res = await fetch(`${edgeUrl}/health`);
    if (!res.ok) return false;
    const body = await res.text();
    return body.includes('"auth":"dev"');
  } catch {
    return false;
  }
};

export const waitFor = async <T>(
  label: string,
  probe: () => Promise<T | undefined> | T | undefined,
  timeoutMs: number,
  intervalMs = 250,
): Promise<T> => {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      const v = await probe();
      if (v !== undefined) return v;
    } catch (e) {
      lastErr = e;
    }
    await sleep(intervalMs);
  }
  throw new Error(
    `timed out after ${timeoutMs}ms waiting for ${label}` +
      (lastErr !== undefined ? ` (last error: ${String(lastErr)})` : ''),
  );
};

/** Start `npx wrangler dev` unless an edge is already healthy at edgeUrl.
 * Returns the running proc (undefined when reusing) plus a `weStarted`
 * flag — teardown must leave a reused edge alive. */
export const startEdge = async (
  paths: ProcPaths,
  port: number,
  log: (line: string) => void,
): Promise<{ proc?: RunningProc; weStarted: boolean }> => {
  if (await edgeHealthy(`http://localhost:${port}`)) {
    log(`edge already healthy on :${port}; reusing`);
    return { weStarted: false };
  }
  const logPath = join(paths.logDir, 'edge.log');
  const out = createWriteStream(logPath);
  // Spawn wrangler's JS entry directly — .cmd shims need cmd.exe, which is
  // not guaranteed present under Git Bash-style environments.
  const wranglerJs = join(
    paths.edgeDir,
    'node_modules',
    'wrangler',
    'bin',
    'wrangler.js',
  );
  const proc = spawn(
    process.execPath,
    [wranglerJs, 'dev', '--port', String(port), '--var', 'AUTH_MODE:dev'],
    {
      cwd: paths.edgeDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: withDllPath(paths),
    },
  );
  proc.stdout?.pipe(out);
  proc.stderr?.pipe(out);
  const running: RunningProc = { proc, logPath, label: 'edge' };
  await waitFor(
    'edge /health {"auth":"dev"}',
    async () => {
      if (proc.exitCode !== null)
        return Promise.reject(new Error('edge exited'));
      const ok = await edgeHealthy(`http://localhost:${port}`);
      return ok ? true : undefined;
    },
    60_000,
    500,
  );
  log(`edge started (pid ${proc.pid})`);
  return { proc: running, weStarted: true };
};

/** `.e2e/bin` carries the MSVC runtime DLLs (msvcp140/vcruntime140*) that
 * workerd.exe and zeron.exe need on machines without the redistributable
 * installed system-wide — Windows searches PATH dirs for DLLs. */
const withDllPath = (paths: ProcPaths): NodeJS.ProcessEnv => ({
  ...process.env,
  PATH: `${join(paths.e2eDir, 'bin')};${process.env.PATH ?? ''}`,
});

export const startEngine = async (
  paths: ProcPaths,
  opts: EngineOptions,
  index = 0,
): Promise<RunningProc> => {
  const dataDir = opts.dataDir;
  mkdirSync(dataDir, { recursive: true });
  const logPath = join(
    paths.logDir,
    `engine${index === 0 ? '' : `-${index}`}.log`,
  );
  const out = createWriteStream(logPath);
  const env: NodeJS.ProcessEnv = {
    ...withDllPath(paths),
    ZERON_DATA_DIR: dataDir,
    ZERON_IPC_PORT: String(opts.ipcPort),
    ZERON_DEVICE_NAME: opts.deviceName,
    ZERON_EDGE_URL: opts.edgeUrl,
    ZERON_EDGE_TOKEN: opts.token,
    ZERON_ORG_ID: opts.orgId,
    ZERON_HARNESS: 'mock',
    RUST_LOG: 'info',
    ...(opts.mockDelayMs !== undefined
      ? { ZERON_MOCK_DELAY_MS: String(opts.mockDelayMs) }
      : {}),
    ...(opts.mockQuestion ? { ZERON_MOCK_QUESTION: '1' } : {}),
    ...(opts.mockChars !== undefined
      ? { ZERON_MOCK_CHARS: String(opts.mockChars) }
      : {}),
    ...opts.extraEnv,
  };
  const proc = spawn(paths.engineBin, ['headless'], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout!.pipe(out);
  proc.stderr!.pipe(out);
  return { proc, logPath, label: `engine${index}` };
};

/** Kill a child process tree (Windows: taskkill /T /F). */
export const killProc = (running: RunningProc | undefined): void => {
  if (running === undefined) return;
  const pid = running.proc.pid;
  if (pid === undefined) return;
  try {
    execFileSync('taskkill', ['/pid', String(pid), '/t', '/f'], {
      stdio: 'ignore',
    });
  } catch {
    try {
      running.proc.kill('SIGKILL');
    } catch {
      /* already gone */
    }
  }
};

export const ensureLogDir = (e2eDir: string): string => {
  const logDir = join(e2eDir, 'logs');
  mkdirSync(logDir, { recursive: true });
  return logDir;
};
