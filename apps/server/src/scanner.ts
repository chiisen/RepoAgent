import { readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { simpleGit } from 'simple-git';
import type { Repo } from './db.js';

export type ScanSummary = { scanId: number; rootDir: string; total: number; okCount: number; failCount: number };

const SKIP_DIRS = new Set(['node_modules', '.superpowers', '.git']);

async function branchOf(git: ReturnType<typeof simpleGit>): Promise<string> {
  try { return await git.revparse(['--abbrev-ref', 'HEAD']); }
  catch { return ''; }
}

export async function scanRoot(db: DatabaseSync, rootDir: string): Promise<ScanSummary> {
  const root = resolve(rootDir);
  if (!existsSync(root)) throw new Error(`rootDir not found: ${root}`);
  const startedAt = new Date().toISOString();
  const ins = db.prepare('INSERT INTO scans(rootDir, startedAt) VALUES (?, ?)');
  const r = ins.run(root, startedAt);
  const scanId = Number(r.lastInsertRowid);
  let total = 0, okCount = 0, failCount = 0;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || SKIP_DIRS.has(entry.name)) continue;
    const repoPath = join(root, entry.name);
    if (!existsSync(join(repoPath, '.git'))) continue;
    total++;
    try {
      const now = new Date().toISOString();
      const id = await repoId(db, repoPath);
      const git = simpleGit(repoPath);
      const branch = await branchOf(git);
      const status = await git.status();
      const last = await git.log({ maxCount: 1 });
      const latest = last.latest;
      const row: Repo = { id, name: entry.name, path: repoPath, branch, isDirty: status.isClean() ? 0 : 1, dirtyCount: status.files.length, lastCommitHash: latest?.hash ?? '', lastCommitTime: latest?.date ?? '', lastCommitMsg: latest?.message ?? '', lastScannedAt: now, lastError: '' };
      upsertRepo(db, row);
      okCount++;
    } catch (e) {
      failCount++;
      db.prepare('UPDATE repos SET lastError=? WHERE path=?').run(String(e).slice(0, 300), repoPath);
    }
  }
  db.prepare('UPDATE scans SET finishedAt=?, total=?, okCount=?, failCount=? WHERE id=?').run(new Date().toISOString(), total, okCount, failCount, scanId);
  return { scanId, rootDir: root, total, okCount, failCount };
}

async function repoId(db: DatabaseSync, path: string): Promise<string> {
  const row = db.prepare('SELECT id FROM repos WHERE path=?').get(path) as { id: string } | undefined;
  if (row) return row.id;
  const id = randomUUID();
  db.prepare('INSERT INTO repos(id, name, path, branch, isDirty, dirtyCount, lastCommitHash, lastCommitTime, lastCommitMsg, lastScannedAt, lastError) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id, '', path, '', 0, 0, '', '', '', '', '');
  return id;
}

function upsertRepo(db: DatabaseSync, row: Repo) {
  const has = db.prepare('SELECT 1 FROM repos WHERE path=?').get(row.path);
  if (has) {
    db.prepare('UPDATE repos SET name=?, branch=?, isDirty=?, dirtyCount=?, lastCommitHash=?, lastCommitTime=?, lastCommitMsg=?, lastScannedAt=? WHERE path=?').run(row.name, row.branch, row.isDirty, row.dirtyCount, row.lastCommitHash, row.lastCommitTime, row.lastCommitMsg, row.lastScannedAt, row.path);
  } else {
    db.prepare('INSERT INTO repos(id, name, path, branch, isDirty, dirtyCount, lastCommitHash, lastCommitTime, lastCommitMsg, lastScannedAt, lastError) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(row.id, row.name, row.path, row.branch, row.isDirty, row.dirtyCount, row.lastCommitHash, row.lastCommitTime, row.lastCommitMsg, row.lastScannedAt, row.lastError);
  }
}
