import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { openDb } from '../src/db.js';
import { scanRoot } from '../src/scanner.js';

function git(cwd: string, ...args: string[]) { execFileSync('git', [...args], { cwd, stdio: 'pipe' }); }
let root = '';
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'repoagent-scan-'));
  for (const name of ['clean-repo', 'dirty-repo', 'not-a-repo']) mkdirSync(join(root, name), { recursive: true });
  for (const name of ['clean-repo', 'dirty-repo']) {
    const p = join(root, name);
    git(p, 'init'); git(p, 'config', 'user.email', 't@t.t'); git(p, 'config', 'user.name', 't');
    writeFileSync(join(p, 'f.txt'), 'hello');
    git(p, 'add', '.'); git(p, 'commit', '-m', 'init');
  }
  writeFileSync(join(root, 'dirty-repo', 'f.txt'), 'hello dirty');
  writeFileSync(join(root, 'not-a-repo', 'x.txt'), 'x');
});
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

describe('scanRoot', () => {
  it('finds only git repos one level deep with correct dirty flags', async () => {
    const db = openDb(':memory:');
    const summary = await scanRoot(db, root);
    expect(summary.total).toBe(2); expect(summary.okCount).toBe(2); expect(summary.failCount).toBe(0);
    const rows = db.prepare('SELECT name, isDirty, dirtyCount FROM repos ORDER BY name').all() as { name: string; isDirty: number; dirtyCount: number }[];
    expect(rows.map(r => r.name)).toEqual(['clean-repo', 'dirty-repo']);
    expect(rows.find(r => r.name === 'clean-repo')!.isDirty).toBe(0);
    const dirty = rows.find(r => r.name === 'dirty-repo')!;
    expect(dirty.isDirty).toBe(1); expect(dirty.dirtyCount).toBe(1);
  });
  it('records branch and last commit', async () => {
    const db = openDb(':memory:');
    await scanRoot(db, root);
    const row = db.prepare("SELECT branch, lastCommitHash, lastCommitMsg FROM repos WHERE name='clean-repo'").get() as { branch: string; lastCommitHash: string; lastCommitMsg: string };
    expect(row.branch.length).toBeGreaterThan(0);
    expect(row.lastCommitHash).toHaveLength(40);
    expect(row.lastCommitMsg).toBe('init');
  });
});
