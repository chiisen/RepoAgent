import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import express from 'express';
import { openDb } from '../src/db.js';
import { scanRoot } from '../src/scanner.js';
import { createReposRouter } from '../src/routes/repos.js';
import { pullFastForward } from '../src/pull.js';

function git(cwd: string, ...args: string[]) {
  execFileSync('git', [...args], { cwd, stdio: 'pipe' });
}

function ident(cwd: string) {
  git(cwd, 'config', 'user.email', 't@t.t');
  git(cwd, 'config', 'user.name', 't');
}

describe('pullFastForward', () => {
  const roots: string[] = [];
  afterAll(() => {
    for (const r of roots) rmSync(r, { recursive: true, force: true });
  });

  it('skips dirty worktrees', async () => {
    const root = mkdtempSync(join(tmpdir(), 'repoagent-pull-dirty-'));
    roots.push(root);
    const repo = join(root, 'app');
    mkdirSync(repo);
    git(repo, 'init', '-b', 'main');
    ident(repo);
    writeFileSync(join(repo, 'a.txt'), '1');
    git(repo, 'add', '.');
    git(repo, 'commit', '-m', 'i');
    writeFileSync(join(repo, 'a.txt'), '2');
    const r = await pullFastForward(repo, 'dirty-test');
    expect(r.ok).toBe(false);
    expect(r.code).toBe('dirty');
  });

  it('fails without upstream', async () => {
    const root = mkdtempSync(join(tmpdir(), 'repoagent-pull-noremote-'));
    roots.push(root);
    const repo = join(root, 'app');
    mkdirSync(repo);
    git(repo, 'init', '-b', 'main');
    ident(repo);
    writeFileSync(join(repo, 'a.txt'), '1');
    git(repo, 'add', '.');
    git(repo, 'commit', '-m', 'i');
    const r = await pullFastForward(repo, 'noremote-test');
    expect(r.ok).toBe(false);
    expect(r.code).toBe('no_upstream');
  });

  it('fast-forwards from a local origin', async () => {
    const root = mkdtempSync(join(tmpdir(), 'repoagent-pull-ff-'));
    roots.push(root);
    const bare = join(root, 'origin.git');
    mkdirSync(bare);
    git(bare, 'init', '--bare', '-b', 'main');
    const seed = join(root, 'seed');
    git(root, 'clone', bare, seed);
    ident(seed);
    writeFileSync(join(seed, 'a.txt'), '1');
    git(seed, 'add', '.');
    git(seed, 'commit', '-m', 'one');
    git(seed, 'push', '-u', 'origin', 'main');

    const work = join(root, 'work');
    git(root, 'clone', bare, work);
    ident(work);

    writeFileSync(join(seed, 'a.txt'), '2');
    git(seed, 'add', '.');
    git(seed, 'commit', '-m', 'two');
    git(seed, 'push', 'origin', 'main');

    const before = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: work, encoding: 'utf8' }).trim();
    const r = await pullFastForward(work, 'ff-test');
    expect(r.ok).toBe(true);
    const after = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: work, encoding: 'utf8' }).trim();
    expect(after).not.toBe(before);
  });
});

describe('POST /api/repos/:id/pull', () => {
  let root = '';
  let port = 0;
  let server: ReturnType<express.Application['listen']>;
  let db: ReturnType<typeof openDb>;

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'repoagent-pull-api-'));
    const repo = join(root, 'solo');
    mkdirSync(repo);
    git(repo, 'init', '-b', 'main');
    ident(repo);
    writeFileSync(join(repo, 'a.txt'), '1');
    git(repo, 'add', '.');
    git(repo, 'commit', '-m', 'i');
    db = openDb(':memory:');
    await scanRoot(db, root);
    const app = express();
    app.use(express.json());
    app.use('/api', createReposRouter(db));
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => resolve());
    });
    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('no port');
    port = addr.port;
  });

  afterAll(() => {
    server.close();
    rmSync(root, { recursive: true, force: true });
  });

  it('returns 409 when dirty is not involved; 400 without upstream', async () => {
    const list = await fetch(`http://127.0.0.1:${port}/api/repos`);
    const body = await list.json() as { repos: { id: string }[] };
    const res = await fetch(`http://127.0.0.1:${port}/api/repos/${body.repos[0].id}/pull`, { method: 'POST' });
    expect(res.status).toBe(400);
    const j = await res.json() as { code: string; message: string };
    expect(j.code).toBe('no_upstream');
    expect(j.message).toMatch(/upstream/i);
    const again = await fetch(`http://127.0.0.1:${port}/api/repos`);
    const listed = await again.json() as { repos: { lastPullAt: string; lastPullMsg: string }[] };
    expect(listed.repos[0].lastPullAt).toMatch(/^\d{4}-/);
    expect(listed.repos[0].lastPullMsg).toMatch(/upstream/i);
  });
});
