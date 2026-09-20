import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { openDb } from '../src/db.js';
import { scanRoot, windowStart } from '../src/scanner.js';
import { configStore } from '../src/config.js';

function git(cwd: string, ...args: string[]) { execFileSync('git', [...args], { cwd, stdio: 'pipe' }); }
function gitDated(cwd: string, iso: string, ...args: string[]) {
  execFileSync('git', [...args], {
    cwd,
    stdio: 'pipe',
    env: { ...process.env, GIT_AUTHOR_DATE: iso, GIT_COMMITTER_DATE: iso },
  });
}
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

describe('normalizeRootDir', () => {
  it('strips trailing separators but keeps drive root', async () => {
    const { normalizeRootDir } = await import('../src/config.js');
    if (process.platform === 'win32') {
      expect(normalizeRootDir('D:\\github\\')).toBe('D:\\github');
      expect(normalizeRootDir('D:\\github/')).toBe('D:\\github');
      expect(normalizeRootDir('D:\\')).toMatch(/^D:\\$/i);
    } else {
      expect(normalizeRootDir('/tmp/foo/')).toBe('/tmp/foo');
    }
  });
});

describe('windowStart', () => {
  it('回傳今日／本週一／本月 1 號的本地凌晨', () => {
    const now = new Date(2026, 8, 20, 15, 30); // 2026-09-20（週日）
    expect(new Date(windowStart('today', now)).getDate()).toBe(20);
    const week = new Date(windowStart('week', now));
    expect(week.getDay()).toBe(1);
    expect(week.getDate()).toBe(14); // 該週週一
    expect(new Date(windowStart('month', now)).getDate()).toBe(1);
  });
});

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
  it('records total commit count', async () => {
    const p = join(root, 'clean-repo');
    writeFileSync(join(p, 'f.txt'), 'second');
    git(p, 'add', '.');
    git(p, 'commit', '-m', 'second');
    const db = openDb(':memory:');
    await scanRoot(db, root);
    const row = db.prepare("SELECT commitCount FROM repos WHERE name='clean-repo'").get() as { commitCount: number };
    expect(row.commitCount).toBe(2);
  });
  it('records today/week/month commit counts (calendar)', async () => {
    const p = join(root, 'hist-repo');
    mkdirSync(p, { recursive: true });
    git(p, 'init');
    git(p, 'config', 'user.email', 't@t.t');
    git(p, 'config', 'user.name', 't');
    writeFileSync(join(p, 'a.txt'), 'a');
    gitDated(p, '2020-01-01T12:00:00', 'add', '.');
    gitDated(p, '2020-01-01T12:00:00', 'commit', '-m', 'old');
    writeFileSync(join(p, 'b.txt'), 'b');
    git(p, 'add', '.');
    git(p, 'commit', '-m', 'new');
    const db = openDb(':memory:');
    await scanRoot(db, root);
    const row = db.prepare("SELECT commitCount, commitsToday, commitsWeek, commitsMonth FROM repos WHERE name='hist-repo'").get() as {
      commitCount: number;
      commitsToday: number;
      commitsWeek: number;
      commitsMonth: number;
    };
    expect(row.commitCount).toBe(2);
    expect(row.commitsToday).toBe(1);
    expect(row.commitsWeek).toBe(1);
    expect(row.commitsMonth).toBe(1);
  });
  it('extrasEnabled 時寫入 language／sizeBytes，不改 git 12 秒逾時', async () => {
    writeFileSync(join(root, 'clean-repo', 'main.ts'), 'export {}\n');
    writeFileSync(join(root, 'clean-repo', 'tsconfig.json'), '{}');
    configStore.extrasEnabled = true;
    try {
      const db = openDb(':memory:');
      await scanRoot(db, root);
      const row = db.prepare("SELECT language, sizeBytes FROM repos WHERE name='clean-repo'").get() as {
        language: string;
        sizeBytes: number;
      };
      expect(row.language).toBe('TypeScript');
      expect(row.sizeBytes).toBeGreaterThan(10);
    } finally {
      configStore.extrasEnabled = false;
    }
  });
  it('drops repos from a previous rootDir on the next scan', async () => {
    const db = openDb(':memory:');
    await scanRoot(db, root);
    const other = mkdtempSync(join(tmpdir(), 'repoagent-scan-b-'));
    const p = join(other, 'only-b');
    mkdirSync(p, { recursive: true });
    git(p, 'init'); git(p, 'config', 'user.email', 't@t.t'); git(p, 'config', 'user.name', 't');
    writeFileSync(join(p, 'f.txt'), 'b');
    git(p, 'add', '.'); git(p, 'commit', '-m', 'b');
    try {
      await scanRoot(db, other);
      const rows = db.prepare('SELECT name, path FROM repos').all() as { name: string; path: string }[];
      expect(rows).toHaveLength(1);
      expect(rows[0].name).toBe('only-b');
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });
  it('邊掃邊寫：每個 repo 寫入後立即回呼 onRepo', async () => {
    const db = openDb(':memory:');
    const seen: string[] = [];
    await scanRoot(db, root, (r) => {
      const row = db.prepare('SELECT name FROM repos WHERE id=?').get(r.id) as { name: string } | undefined;
      expect(row?.name).toBe(r.name);
      seen.push(r.name);
    });
    expect(seen.sort()).toEqual(['clean-repo', 'dirty-repo']);
  });
});
