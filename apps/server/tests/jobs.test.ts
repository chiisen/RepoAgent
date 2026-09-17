import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import express from 'express';
import { openDb } from '../src/db.js';
import { scanRoot } from '../src/scanner.js';
import { createReposRouter } from '../src/routes/repos.js';
import { createJobsRouter } from '../src/routes/jobs.js';

// 測試專用 pi 哨兵：只有這個指令走 mock child，其餘（git 等）透傳給真正的 spawn，
// simple-git 才能正常運作。
const PI_SENTINEL = '__test_pi__';

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    spawn: vi.fn((cmd: string, ...rest: any[]) => {
      const queue = (globalThis as any).__piChildren as any[] | undefined;
      if (cmd === PI_SENTINEL && queue && queue.length > 0) return queue.shift();
      return (actual.spawn as any)(cmd, ...rest);
    }),
  };
});

function git(cwd: string, ...args: string[]) { execFileSync('git', [...args], { cwd, stdio: 'pipe' }); }

function pushMockChild() {
  const child: any = new EventEmitter();
  child.kill = vi.fn(() => true);
  child.exitCode = null;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  (((globalThis as any).__piChildren ??= []) as any[]).push(child);
  return child as { kill: ReturnType<typeof vi.fn>; stdout: EventEmitter; stderr: EventEmitter; emit: EventEmitter['emit'] };
}

let root = '';
let port = 0;
let server: ReturnType<express.Application['listen']>;
let db: ReturnType<typeof openDb>;
let repoId = '';
let jobLogs: string[] = [];

function trackLog(jobId: string) {
  jobLogs.push(resolve('data', 'jobs', `${jobId}.log`));
}

async function api(path: string, init?: RequestInit) {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, init);
  return { status: res.status, body: (await res.json()) as any };
}

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'repoagent-jobs-'));
  mkdirSync(join(root, 'a'), { recursive: true });
  git(join(root, 'a'), 'init', '-q');
  git(join(root, 'a'), 'config', 'user.email', 't@t.t');
  git(join(root, 'a'), 'config', 'user.name', 't');
  writeFileSync(join(root, 'a', 'f.txt'), 'hello');
  git(join(root, 'a'), 'add', '.');
  git(join(root, 'a'), 'commit', '-m', 'init');
  appendFileSync(join(root, 'a', 'f.txt'), 'dirty');

  db = openDb(':memory:');
  await scanRoot(db, root);
  repoId = (db.prepare('SELECT id FROM repos WHERE name=?').get('a') as { id: string }).id;

  const app = express();
  app.use(express.json());
  app.use('/api', createReposRouter(db));
  app.use('/api', createJobsRouter());
  server = app.listen(0);
  await new Promise<void>((resolve) => server.on('listening', () => resolve()));
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
  for (const logPath of jobLogs) rmSync(logPath, { force: true });
});

describe('GET /api/repos/:id', () => {
  it('回傳 repo、statusShort 與近 5 筆 commit', async () => {
    const { status, body } = await api(`/api/repos/${repoId}`);
    expect(status).toBe(200);
    expect(body.repo.name).toBe('a');
    expect(Array.isArray(body.statusShort)).toBe(true);
    expect(body.statusShort).toHaveLength(1);
    expect(body.statusShort[0]).toContain('f.txt');
    expect(body.recentCommits[0].message).toBe('init');
    expect(body.recentCommits[0].hash).toMatch(/^[0-9a-f]{40}$/);
  });

  it('未知 id 回 404', async () => {
    const { status } = await api('/api/repos/no-such-id');
    expect(status).toBe(404);
  });
});

describe('POST /api/repos/:id/optimize', () => {
  it('建 job 並回 202，完成後可查到 done 與 log 尾', async () => {
    const child = pushMockChild();
    const { status, body } = await api(`/api/repos/${repoId}/optimize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(status).toBe(202);
    expect(body.job).toHaveProperty('id');
    trackLog(body.job.id);

    child.stdout.emit('data', Buffer.from('opt line\n'));
    child.emit('exit', 0);

    const got = await api(`/api/jobs/${body.job.id}`);
    expect(got.body.job.status).toBe('done');
    expect(got.body.logTail).toContain('opt line');

    // issue #2：exit 0 自動重掃並回前後 diff（repo a 掃描時即 dirty，mock pi 未改檔）；
    // 重掃非同步，輪詢等待 diff 落定
    let diff: any = null;
    for (let i = 0; i < 100 && !diff; i++) {
      const g = await api(`/api/jobs/${body.job.id}`);
      diff = g.body.job.diff;
      if (!diff) await new Promise((r) => setTimeout(r, 50));
    }
    expect(diff).toMatchObject({
      before: { isDirty: 1, dirtyCount: 1 },
      after: { isDirty: 1, dirtyCount: 1 },
    });
    expect(diff.after.lastCommitHash).toMatch(/^[0-9a-f]{40}$/);
    expect(diff.after.lastCommitHash).toBe(diff.before.lastCommitHash);
  });

  it('自訂 prompt 透傳給 job', async () => {
    const child = pushMockChild();
    const { body } = await api(`/api/repos/${repoId}/optimize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'custom prompt' }),
    });
    expect(body.job.prompt).toBe('custom prompt');
    trackLog(body.job.id);
    child.emit('exit', 0);
  });

  it('未知 repo 回 404', async () => {
    const { status } = await api('/api/repos/no-such-id/optimize', { method: 'POST' });
    expect(status).toBe(404);
  });

  it('已有執行中 job 時再按回 409，完成後可再按', async () => {
    const child = pushMockChild();
    const first = await api(`/api/repos/${repoId}/optimize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(first.status).toBe(202);
    trackLog(first.body.job.id);

    const second = await api(`/api/repos/${repoId}/optimize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(second.status).toBe(409);
    expect(second.body.jobId).toBe(first.body.job.id);

    child.stdout.emit('data', Buffer.from('x\n'));
    child.emit('exit', 0);

    const child3 = pushMockChild();
    const third = await api(`/api/repos/${repoId}/optimize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(third.status).toBe(202);
    trackLog(third.body.job.id);
    child3.emit('exit', 0);
  });
});

describe('GET /api/jobs/:id 與 DELETE /api/jobs/:id', () => {
  it('未知 job 回 404', async () => {
    expect((await api('/api/jobs/no-such-id')).status).toBe(404);
  });

  it('DELETE 取消執行中 job，之後查詢為 404', async () => {
    pushMockChild();
    const created = await api(`/api/repos/${repoId}/optimize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const jobId = created.body.job.id as string;
    trackLog(jobId);

    const del = await api(`/api/jobs/${jobId}`, { method: 'DELETE' });
    expect(del.body).toMatchObject({ status: 'cancelled', jobId });
    expect((await api(`/api/jobs/${jobId}`)).status).toBe(404);
  });

  it('DELETE 未知 job 回 404', async () => {
    const { status } = await api('/api/jobs/no-such-id', { method: 'DELETE' });
    expect(status).toBe(404);
  });
});
