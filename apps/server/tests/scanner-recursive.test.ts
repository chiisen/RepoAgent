import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { configStore } from '../src/config.js';
import { openDb } from '../src/db.js';
import { scanRoot } from '../src/scanner.js';

function git(cwd: string, ...args: string[]) {
  execFileSync('git', [...args], { cwd, stdio: 'pipe' });
}

function initRepo(p: string) {
  mkdirSync(p, { recursive: true });
  git(p, 'init', '-q');
  git(p, 'config', 'user.email', 't@t.t');
  git(p, 'config', 'user.name', 't');
  writeFileSync(join(p, 'f.txt'), 'x');
  git(p, 'add', '.');
  git(p, 'commit', '-m', 'i');
}

let root = '';
const saved = { scanRecursive: configStore.scanRecursive, scanDepth: configStore.scanDepth };

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'repoagent-rec-'));
  initRepo(join(root, 'top'));
  initRepo(join(root, 'nest', 'inner'));
  initRepo(join(root, 'nest', 'node_modules', 'pkg'));
});

afterEach(() => {
  configStore.scanRecursive = saved.scanRecursive;
  configStore.scanDepth = saved.scanDepth;
  rmSync(root, { recursive: true, force: true });
});

describe('scanRoot 可選遞迴（issue #12）', () => {
  it('預設只掃下一層，不含 nest/inner', async () => {
    configStore.scanRecursive = false;
    const db = openDb(':memory:');
    const s = await scanRoot(db, root);
    expect(s.total).toBe(1);
    const names = (db.prepare('SELECT name FROM repos ORDER BY name').all() as { name: string }[]).map(
      (r) => r.name,
    );
    expect(names).toEqual(['top']);
  });

  it('recursive 找 nest/inner，略過 node_modules', async () => {
    configStore.scanRecursive = true;
    configStore.scanDepth = 3;
    const db = openDb(':memory:');
    const s = await scanRoot(db, root);
    expect(s.okCount).toBe(2);
    const names = (db.prepare('SELECT name FROM repos ORDER BY name').all() as { name: string }[]).map(
      (r) => r.name,
    );
    expect(names).toEqual(['nest/inner', 'top']);
  });

  it('depth 1 即使 recursive 也只下一層', async () => {
    configStore.scanRecursive = true;
    configStore.scanDepth = 1;
    const db = openDb(':memory:');
    await scanRoot(db, root);
    const names = (db.prepare('SELECT name FROM repos').all() as { name: string }[]).map((r) => r.name);
    expect(names).toEqual(['top']);
  });
});
