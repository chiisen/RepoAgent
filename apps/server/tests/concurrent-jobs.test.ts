import { execFileSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import express from 'express';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { configStore } from '../src/config.js';
import { openDb } from '../src/db.js';
import { initOptimizer } from '../src/optimizer.js';
import { createJobsRouter } from '../src/routes/jobs.js';
import { createReposRouter } from '../src/routes/repos.js';
import { scanRoot } from '../src/scanner.js';

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
  const child = new EventEmitter() as EventEmitter & {
    kill: ReturnType<typeof vi.fn>;
    stdout: EventEmitter;
    stderr: EventEmitter;
    exitCode: null;
  };
  child.kill = vi.fn(() => true);
  child.exitCode = null;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  const g = globalThis as { __piChildren?: unknown[] };
  g.__piChildren ??= [];
  g.__piChildren.push(child);
  return child;
}

let root = '';
let port = 0;
let server: ReturnType<express.Application['listen']>;
const ids: Record<string, string> = {};
const jobLogs: string[] = [];
const savedConc = configStore.piConcurrency;

async function api(path: string, init?: RequestInit) {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, init);
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

beforeAll(async () => {
  vi.stubEnv('PI_PATH', PI_SENTINEL);
  root = mkdtempSync(join(tmpdir(), 'repoagent-conc-'));
  for (const name of ['a', 'b', 'c']) {
    mkdirSync(join(root, name), { recursive: true });
    git(join(root, name), 'init', '-q');
    git(join(root, name), 'config', 'user.email', 't@t.t');
    git(join(root, name), 'config', 'user.name', 't');
    writeFileSync(join(root, name, 'f.txt'), 'h');
    git(join(root, name), 'add', '.');
    git(join(root, name), 'commit', '-m', 'i');
  }
  const db = openDb(':memory:');
  initOptimizer({ emit: () => {} } as never, db);
  await scanRoot(db, root);
  for (const name of ['a', 'b', 'c']) {
    ids[name] = (db.prepare('SELECT id FROM repos WHERE name=?').get(name) as { id: string }).id;
  }
  const app = express();
  app.use(express.json());
  app.use('/api', createReposRouter(db));
  app.use('/api', createJobsRouter());
  server = app.listen(0);
  await new Promise<void>((r) => server.on('listening', () => r()));
  port = (server.address() as { port: number }).port;
});

afterAll(async () => {
  configStore.piConcurrency = savedConc;
  vi.unstubAllEnvs();
  await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  rmSync(root, { recursive: true, force: true });
  for (const p of jobLogs) rmSync(p, { force: true });
});

afterEach(() => {
  configStore.piConcurrency = 2;
});

describe('多併發 pi（issue #10）', () => {
  it('不同 repo 可同時 202，達上限回 409；取消其一不影響另一', async () => {
    configStore.piConcurrency = 2;
    const c1 = pushMockChild();
    const c2 = pushMockChild();
    const a = await api(`/api/repos/${ids.a}/optimize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    const b = await api(`/api/repos/${ids.b}/optimize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(a.status).toBe(202);
    expect(b.status).toBe(202);
    const ja = (a.body.job as { id: string }).id;
    const jb = (b.body.job as { id: string }).id;
    expect(ja).not.toBe(jb);
    jobLogs.push(resolve('data', 'jobs', `${ja}.log`), resolve('data', 'jobs', `${jb}.log`));

    const cap = await api(`/api/repos/${ids.c}/optimize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(cap.status).toBe(409);
    expect(String(cap.body.error)).toMatch(/併發上限/);
    expect(cap.body.jobId).toBeUndefined();

    const listed = await api('/api/jobs');
    expect(listed.status).toBe(200);
    expect((listed.body.jobs as unknown[]).length).toBe(2);

    const del = await api(`/api/jobs/${ja}`, { method: 'DELETE' });
    expect(del.status).toBe(200);
    const still = await api(`/api/jobs/${jb}`);
    expect(still.status).toBe(200);
    expect((still.body.job as { status: string }).status).toMatch(/running|queued/);

    c2.emit('exit', 0);
    c1.emit('exit', 0);
  });

  it('同一 repo 第二個仍 409 並帶回既有 jobId', async () => {
    const child = pushMockChild();
    const first = await api(`/api/repos/${ids.a}/optimize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(first.status).toBe(202);
    const jid = (first.body.job as { id: string }).id;
    jobLogs.push(resolve('data', 'jobs', `${jid}.log`));
    const second = await api(`/api/repos/${ids.a}/optimize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(second.status).toBe(409);
    expect(second.body.jobId).toBe(jid);
    child.emit('exit', 0);
  });
});
