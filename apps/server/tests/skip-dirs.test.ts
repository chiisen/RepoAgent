import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { configStore, parseSkipDirs } from '../src/config.js';
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

describe('parseSkipDirs', () => {
  it('正規化小寫、去空白、拒絕路徑', () => {
    expect(parseSkipDirs([' Vendor ', 'CACHE'])).toEqual(['vendor', 'cache']);
    expect(() => parseSkipDirs(['a/b'])).toThrow(/path/);
    expect(() => parseSkipDirs(Array.from({ length: 41 }, (_, i) => `d${i}`))).toThrow(/at most 40/);
  });
});

describe('scanRoot skipDirs（issue #13）', () => {
  let root = '';
  const saved = {
    skipDirs: configStore.skipDirs,
    scanRecursive: configStore.scanRecursive,
    scanDepth: configStore.scanDepth,
  };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'repoagent-skip-'));
    initRepo(join(root, 'keep'));
    initRepo(join(root, 'vendor', 'lib'));
  });
  afterEach(() => {
    configStore.skipDirs = saved.skipDirs;
    configStore.scanRecursive = saved.scanRecursive;
    configStore.scanDepth = saved.scanDepth;
    rmSync(root, { recursive: true, force: true });
  });

  it('skipDirs 含 vendor 時遞迴不納入 vendor/lib', async () => {
    configStore.scanRecursive = true;
    configStore.scanDepth = 3;
    configStore.skipDirs = ['vendor'];
    const db = openDb(':memory:');
    await scanRoot(db, root);
    const names = (db.prepare('SELECT name FROM repos ORDER BY name').all() as { name: string }[]).map(
      (r) => r.name,
    );
    expect(names).toEqual(['keep']);
  });

  it('拿掉 vendor 後可掃到 vendor/lib', async () => {
    configStore.scanRecursive = true;
    configStore.scanDepth = 3;
    configStore.skipDirs = [];
    const db = openDb(':memory:');
    await scanRoot(db, root);
    const names = (db.prepare('SELECT name FROM repos ORDER BY name').all() as { name: string }[]).map(
      (r) => r.name,
    );
    expect(names).toEqual(['keep', 'vendor/lib']);
  });
});
