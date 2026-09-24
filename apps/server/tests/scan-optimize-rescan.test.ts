import { execFileSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { openDb } from '../src/db.js';
import { initOptimizer } from '../src/optimizer.js';

const PI_SENTINEL = '__test_pi__';

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    spawn: vi.fn((cmd: string, ...rest: unknown[]) => {
      const queue = (globalThis as { __piChildren?: unknown[] }).__piChildren;
      if (cmd === PI_SENTINEL && queue && queue.length > 0) return queue.shift();
      return (actual.spawn as (...a: unknown[]) => unknown)(cmd, ...rest);
    }),
  };
});

function git(cwd: string, ...args: string[]) {
  execFileSync('git', [...args], { cwd, stdio: 'pipe' });
}

function pushMockChild() {
  const child: EventEmitter & { kill: ReturnType<typeof vi.fn>; stdout: EventEmitter; stderr: EventEmitter } =
    new EventEmitter() as never;
  child.kill = vi.fn(() => true);
  (child as unknown as { exitCode: null }).exitCode = null;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  const g = globalThis as { __piChildren?: unknown[] };
  g.__piChildren ??= [];
  g.__piChildren.push(child);
  return child;
}

function emit() {
  /* WS 可選 */
}

let root = '';
let repoPath = '';
let port = 0;
let server: ReturnType<ReturnType<typeof createApp>['listen']>;
let jobLogs: string[] = [];

async function api(path: string, init?: RequestInit) {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, init);
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'repoagent-chain-'));
  repoPath = join(root, 'demo');
  mkdirSync(repoPath, { recursive: true });
  git(repoPath, 'init', '-q');
  git(repoPath, 'config', 'user.email', 't@t.t');
  git(repoPath, 'config', 'user.name', 't');
  writeFileSync(join(repoPath, 'f.txt'), 'hello');
  git(repoPath, 'add', '.');
  git(repoPath, 'commit', '-m', 'init');

  const db = openDb(':memory:');
  initOptimizer({ emit, clients: new Set() } as never, db);
  const app = createApp(db);
  server = app.listen(0);
  await new Promise<void>((r) => server.on('listening', () => r()));
  port = (server.address() as { port: number }).port;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  rmSync(root, { recursive: true, force: true });
});

beforeEach(() => {
  vi.stubEnv('PI_PATH', PI_SENTINEL);
  jobLogs = [];
});

afterEach(() => {
  vi.unstubAllEnvs();
  for (const p of jobLogs) rmSync(p, { force: true });
});

describe('API e2e：scan → optimize → rescan（issue #7）', () => {
  it('掃乾淨 repo、mock pi 改檔 exit 0 後 diff 與列表皆變 dirty', async () => {
    const scanned = await api('/api/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rootDir: root }),
    });
    expect(scanned.status).toBe(200);
    expect(scanned.body).toMatchObject({ total: 1, okCount: 1, failCount: 0 });

    const list = await api('/api/repos');
    expect(list.status).toBe(200);
    const repos = list.body.repos as { id: string; name: string; isDirty: number; lastCommitHash: string }[];
    expect(repos).toHaveLength(1);
    expect(repos[0].name).toBe('demo');
    expect(repos[0].isDirty).toBe(0);
    const repoId = repos[0].id;
    const hashBefore = repos[0].lastCommitHash;

    const child = pushMockChild();
    const opt = await api(`/api/repos/${repoId}/optimize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(opt.status).toBe(202);
    const job = opt.body.job as { id: string };
    expect(job.id).toBeTruthy();
    jobLogs.push(resolve('data', 'jobs', `${job.id}.log`));

    appendFileSync(join(repoPath, 'f.txt'), '\nfrom-pi');
    child.stdout.emit('data', Buffer.from('pi ok\n'));
    child.emit('exit', 0);

    let diff: {
      before: { isDirty: number; dirtyCount: number; lastCommitHash: string; branch: string };
      after: { isDirty: number; dirtyCount: number; lastCommitHash: string; branch: string };
    } | null = null;
    for (let i = 0; i < 100 && !diff; i++) {
      const g = await api(`/api/jobs/${job.id}`);
      expect(g.status).toBe(200);
      const j = g.body.job as { status: string; diff: typeof diff };
      if (j.status === 'done' && j.diff) diff = j.diff;
      else await new Promise((r) => setTimeout(r, 50));
    }
    expect(diff).toMatchObject({
      before: { isDirty: 0, dirtyCount: 0, lastCommitHash: hashBefore },
      after: { isDirty: 1, dirtyCount: 1, lastCommitHash: hashBefore },
    });
    expect(diff!.before.branch).toBe(diff!.after.branch);

    const afterList = await api('/api/repos');
    const after = (afterList.body.repos as { id: string; isDirty: number; dirtyCount: number }[]).find(
      (r) => r.id === repoId,
    );
    expect(after).toMatchObject({ isDirty: 1, dirtyCount: 1 });
  });
});
