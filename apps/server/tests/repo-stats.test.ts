import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDb } from '../src/db.js';
import { scanRoot } from '../src/scanner.js';
import { createReposRouter } from '../src/routes/repos.js';
import express from 'express';

function git(cwd: string, ...args: string[]) {
  execFileSync('git', [...args], { cwd, stdio: 'pipe' });
}

let root = '', port = 0, server: ReturnType<express.Application['listen']>;
let db: ReturnType<typeof openDb>;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'repoagent-stats-'));
  for (const name of ['clean-repo', 'dirty-repo']) {
    mkdirSync(join(root, name), { recursive: true });
    git(join(root, name), 'init', '-q');
    git(join(root, name), 'config', 'user.email', 't@t.t');
    git(join(root, name), 'config', 'user.name', 't');
    writeFileSync(join(root, name, 'f.txt'), 'h');
    git(join(root, name), 'add', '.');
    git(join(root, name), 'commit', '-m', 'i');
  }
  writeFileSync(join(root, 'dirty-repo', 'f.txt'), 'changed');
  writeFileSync(join(root, 'clean-repo', 'f2.txt'), 'second');
  git(join(root, 'clean-repo'), 'add', '.');
  git(join(root, 'clean-repo'), 'commit', '-m', 'i2');
  db = openDb(':memory:');
  await scanRoot(db, root);

  const app = express();
  app.use(express.json());
  app.use('/api', createReposRouter(db));
  server = app.listen(0);
  await new Promise<void>((resolve) => server.on('listening', () => resolve()));
  port = (server.address() as { port: number }).port;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  rmSync(root, { recursive: true, force: true });
});

type ListBody = {
  total: number;
  stats: { total: number; dirty: number };
  commitRanking: { name: string; commitCount: number; commitsToday: number; commitsWeek: number; commitsMonth: number }[];
};

describe('GET /api/repos stats', () => {
  it('回傳全庫 total 與 dirty', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/repos`);
    const body = (await res.json()) as ListBody;
    expect(body.total).toBe(2);
    expect(body.stats).toEqual({ total: 2, dirty: 1 });
  });
  it('commitRanking 全庫依 commit 數排序，不受篩選影響', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/repos?filter=dirty`);
    const body = (await res.json()) as ListBody;
    expect(body.commitRanking.map((r) => r.name)).toEqual(['clean-repo', 'dirty-repo']);
    expect(body.commitRanking.map((r) => r.commitCount)).toEqual([2, 1]);
    expect(body.commitRanking.map((r) => r.commitsToday)).toEqual([2, 1]);
    expect(body.commitRanking.map((r) => r.commitsMonth)).toEqual([2, 1]);
  });
  it('filter 只影響列表，不影響 stats', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/repos?filter=dirty`);
    const body = (await res.json()) as ListBody;
    expect(body.total).toBe(1);
    expect(body.stats).toEqual({ total: 2, dirty: 1 });
  });
  it('q 只影響列表，不影響 stats', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/repos?q=clean`);
    const body = (await res.json()) as ListBody;
    expect(body.total).toBe(1);
    expect(body.stats).toEqual({ total: 2, dirty: 1 });
  });
});
