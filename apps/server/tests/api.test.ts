import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDb } from '../src/db.js';
import { scanRoot } from '../src/scanner.js';
import { createReposRouter } from '../src/routes/repos.js';
import { createScanRouter } from '../src/routes/scan.js';
import express from 'express';

function git(cwd: string, ...args: string[]) { execFileSync('git', [...args], { cwd, stdio: 'pipe' }); }
let root = '', port = 0, server: ReturnType<express.Application['listen']>;
let db: ReturnType<typeof openDb>;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'repoagent-api-'));
  for (const name of ['a']) { 
    mkdirSync(join(root, name), { recursive: true }); 
    git(join(root, name), 'init', '-q'); 
    git(join(root, name), 'config', 'user.email', 't@t.t'); 
    git(join(root, name), 'config', 'user.name', 't'); 
    writeFileSync(join(root, name, 'f.txt'), 'h'); 
    git(join(root, name), 'add', '.'); 
    git(join(root, name), 'commit', '-m', 'i'); 
  }
  db = openDb(':memory:');
  await scanRoot(db, root);
  
  const app = express();
  app.use(express.json());
  app.use('/api', createReposRouter(db));
  app.use('/api', createScanRouter(db));
  server = app.listen(0);
  await new Promise<void>((resolve) => server.on('listening', () => resolve()));
  port = (server.address() as { port: number }).port;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  rmSync(root, { recursive: true, force: true });
});

describe('GET /api/repos', () => {
  it('returns repos with branch/isDirty/dirtyCount/lastCommit fields', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/repos`);
    const body = await res.json() as { repos: any[]; total: number };
    expect(body.total).toBe(1);
    const r = body.repos[0];
    expect(r).toHaveProperty('branch'); 
    expect(r.isDirty).toBe(0); 
    expect(r.dirtyCount).toBe(0);
    expect(r).toHaveProperty('lastCommitHash', expect.stringMatching(/^[0-9a-f]{40}$/));
    expect(r).toHaveProperty('lastCommitMsg', 'i');
  });
  it('filters by dirty', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/repos?filter=dirty`);
    const body = await res.json() as { repos: any[]; total: number };
    expect(body.total).toBe(0);
  });
});
describe('GET /api/scan/progress', () => {
  it('returns done/total fields', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/scan/progress`);
    expect(res.status).toBe(200);
    const body = await res.json() as { running: boolean; total: number; done: number };
    expect(body).toHaveProperty('running');
    expect(body).toHaveProperty('total');
    expect(body).toHaveProperty('done');
  });
});
describe('POST /api/scan', () => {
  it('triggers scan and updates count', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/scan`, { 
      method: 'POST', 
      headers: {'Content-Type':'application/json'}, 
      body: JSON.stringify({rootDir: root}) 
    });
    const body = await res.json() as { scanId: number; total: number };
    expect(body.total).toBe(1);
    const r2 = await fetch(`http://127.0.0.1:${port}/api/repos`);
    expect((await r2.json()).total).toBe(1);
  });
});