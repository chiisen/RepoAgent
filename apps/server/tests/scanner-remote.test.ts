import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { openDb } from '../src/db.js';
import { scanRoot } from '../src/scanner.js';

function git(cwd: string, ...args: string[]) {
  execFileSync('git', [...args], { cwd, stdio: 'pipe' });
}

type Row = {
  name: string;
  remoteUrl: string | null;
  ahead: number | null;
  behind: number | null;
};

function row(db: ReturnType<typeof openDb>, name: string): Row {
  return db.prepare('SELECT name, remoteUrl, ahead, behind FROM repos WHERE name=?').get(name) as Row;
}

let root = '';

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'repoagent-remote-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('scanRoot remote / ahead / behind（issue #9）', () => {
  it('無 origin 時 remote 空、ahead/behind 為 null', async () => {
    const p = join(root, 'solo');
    mkdirSync(p, { recursive: true });
    git(p, 'init', '-q');
    git(p, 'config', 'user.email', 't@t.t');
    git(p, 'config', 'user.name', 't');
    writeFileSync(join(p, 'f.txt'), 'a');
    git(p, 'add', '.');
    git(p, 'commit', '-m', 'init');

    const db = openDb(':memory:');
    await scanRoot(db, root);
    const r = row(db, 'solo');
    expect(r.remoteUrl).toBe('');
    expect(r.ahead).toBeNull();
    expect(r.behind).toBeNull();
  });

  it('clone 後與 origin 同步：有 remote、ahead 0 behind 0', async () => {
    const bare = join(root, 'origin.git');
    mkdirSync(bare, { recursive: true });
    git(bare, 'init', '--bare', '-q');
    git(bare, 'symbolic-ref', 'HEAD', 'refs/heads/main');
    const seed = join(root, 'seed');
    mkdirSync(seed, { recursive: true });
    git(seed, 'init', '-q');
    git(seed, 'config', 'user.email', 't@t.t');
    git(seed, 'config', 'user.name', 't');
    writeFileSync(join(seed, 'f.txt'), 'a');
    git(seed, 'add', '.');
    git(seed, 'commit', '-m', 'init');
    git(seed, 'branch', '-M', 'main');
    git(seed, 'remote', 'add', 'origin', bare);
    git(seed, 'push', '-u', 'origin', 'main');

    const work = join(root, 'work');
    git(root, 'clone', '-q', bare, 'work');
    git(work, 'config', 'user.email', 't@t.t');
    git(work, 'config', 'user.name', 't');

    const db = openDb(':memory:');
    await scanRoot(db, root);
    const r = row(db, 'work');
    expect(r.remoteUrl).toBe(bare);
    expect(r.ahead).toBe(0);
    expect(r.behind).toBe(0);
  });

  it('本地多一個 commit：ahead 1（不 fetch）', async () => {
    const bare = join(root, 'origin.git');
    mkdirSync(bare, { recursive: true });
    git(bare, 'init', '--bare', '-q');
    git(bare, 'symbolic-ref', 'HEAD', 'refs/heads/main');
    const seed = join(root, 'seed');
    mkdirSync(seed, { recursive: true });
    git(seed, 'init', '-q');
    git(seed, 'config', 'user.email', 't@t.t');
    git(seed, 'config', 'user.name', 't');
    writeFileSync(join(seed, 'f.txt'), 'a');
    git(seed, 'add', '.');
    git(seed, 'commit', '-m', 'init');
    git(seed, 'branch', '-M', 'main');
    git(seed, 'remote', 'add', 'origin', bare);
    git(seed, 'push', '-u', 'origin', 'main');
    git(root, 'clone', '-q', bare, 'work');
    git(join(root, 'work'), 'config', 'user.email', 't@t.t');
    git(join(root, 'work'), 'config', 'user.name', 't');
    writeFileSync(join(root, 'work', 'f.txt'), 'local');
    git(join(root, 'work'), 'add', '.');
    git(join(root, 'work'), 'commit', '-m', 'local');

    const db = openDb(':memory:');
    await scanRoot(db, root);
    const r = row(db, 'work');
    expect(r.ahead).toBe(1);
    expect(r.behind).toBe(0);
  });

  it('測試裡 fetch 後 reset：behind 1（掃描本身不 fetch）', async () => {
    const bare = join(root, 'origin.git');
    mkdirSync(bare, { recursive: true });
    git(bare, 'init', '--bare', '-q');
    git(bare, 'symbolic-ref', 'HEAD', 'refs/heads/main');
    const seed = join(root, 'seed');
    mkdirSync(seed, { recursive: true });
    git(seed, 'init', '-q');
    git(seed, 'config', 'user.email', 't@t.t');
    git(seed, 'config', 'user.name', 't');
    writeFileSync(join(seed, 'f.txt'), 'a');
    git(seed, 'add', '.');
    git(seed, 'commit', '-m', 'init');
    git(seed, 'branch', '-M', 'main');
    git(seed, 'remote', 'add', 'origin', bare);
    git(seed, 'push', '-u', 'origin', 'main');
    git(root, 'clone', '-q', bare, 'work');
    git(join(root, 'work'), 'config', 'user.email', 't@t.t');
    git(join(root, 'work'), 'config', 'user.name', 't');

    writeFileSync(join(seed, 'f.txt'), 'remote-ahead');
    git(seed, 'add', '.');
    git(seed, 'commit', '-m', 'on-origin');
    git(seed, 'push', 'origin', 'main');
    git(join(root, 'work'), 'fetch', '-q', 'origin');

    const db = openDb(':memory:');
    await scanRoot(db, root);
    const r = row(db, 'work');
    expect(r.ahead).toBe(0);
    expect(r.behind).toBe(1);
    expect(r.remoteUrl).toBe(bare);
  });
});
