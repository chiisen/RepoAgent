import { readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { simpleGit } from 'simple-git';
import type { Repo } from './db.js';

export type ScanSummary = { scanId: number; rootDir: string; total: number; okCount: number; failCount: number };

export type ScanProgress = {
  running: boolean;
  total: number;
  done: number;
  current: string;
};

let scanProgress: ScanProgress = { running: false, total: 0, done: 0, current: '' };

export function getScanProgress(): ScanProgress {
  return { ...scanProgress };
}

function setScanProgress(patch: Partial<ScanProgress>) {
  scanProgress = { ...scanProgress, ...patch };
}

const SKIP_DIRS = new Set(['node_modules', '.superpowers', '.git']);
const GIT_TIMEOUT_MS = 12_000;
const SCAN_CONCURRENCY = 6;

function gitClient(repoPath: string) {
  return simpleGit(repoPath, {
    timeout: { block: GIT_TIMEOUT_MS },
    spawnOptions: {
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
        GCM_INTERACTIVE: 'never',
        GIT_OPTIONAL_LOCKS: '0',
      },
    },
  });
}

async function inspectRepo(repoPath: string): Promise<{
  branch: string;
  isDirty: number;
  dirtyCount: number;
  lastCommitHash: string;
  lastCommitTime: string;
  lastCommitMsg: string;
}> {
  const git = gitClient(repoPath);
  const [branchRaw, porcelain, logOut] = await Promise.all([
    git.raw(['rev-parse', '--abbrev-ref', 'HEAD']).catch(() => ''),
    git.raw(['status', '--porcelain=v1']),
    git.raw(['log', '-1', '--format=%H%x09%aI%x09%s']).catch(() => ''),
  ]);
  const dirtyLines = porcelain.split(/\r?\n/).filter((l) => l.length > 0);
  const [hash = '', time = '', ...msg] = logOut.trim().split('\t');
  return {
    branch: branchRaw.trim(),
    isDirty: dirtyLines.length > 0 ? 1 : 0,
    dirtyCount: dirtyLines.length,
    lastCommitHash: hash,
    lastCommitTime: time,
    lastCommitMsg: msg.join('\t').trim(),
  };
}

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) || 1 }, worker));
  return out;
}

export async function scanRoot(db: DatabaseSync, rootDir: string): Promise<ScanSummary> {
  const root = resolve(rootDir);
  if (!existsSync(root)) throw new Error(`rootDir not found: ${root}`);
  setScanProgress({ running: true, total: 0, done: 0, current: '列目錄…' });
  try {
  const startedAt = new Date().toISOString();
  const ins = db.prepare('INSERT INTO scans(rootDir, startedAt) VALUES (?, ?)');
  const r = ins.run(root, startedAt);
  const scanId = Number(r.lastInsertRowid);

  const dirs = readdirSync(root, { withFileTypes: true }).filter((entry) => {
    if (!entry.isDirectory() || SKIP_DIRS.has(entry.name.toLowerCase())) return false;
    return existsSync(join(root, entry.name, '.git'));
  });
  setScanProgress({ total: dirs.length, current: dirs.length ? '' : '無 git 專案' });

  const inspected = await mapPool(dirs, SCAN_CONCURRENCY, async (entry) => {
    const repoPath = join(root, entry.name);
    setScanProgress({ current: entry.name });
    try {
      const info = await inspectRepo(repoPath);
      setScanProgress({ done: scanProgress.done + 1 });
      return { entry, repoPath, info, error: '' };
    } catch (e) {
      setScanProgress({ done: scanProgress.done + 1 });
      return { entry, repoPath, info: undefined, error: String(e).slice(0, 300) };
    }
  });

  let okCount = 0, failCount = 0;
  const now = new Date().toISOString();
  for (const item of inspected) {
    if (!item.info) {
      failCount++;
      const id = await repoId(db, item.repoPath);
      db.prepare('UPDATE repos SET name=?, lastScannedAt=?, lastError=? WHERE id=?').run(item.entry.name, now, item.error, id);
      continue;
    }
    const id = await repoId(db, item.repoPath);
    upsertRepo(db, {
      id,
      name: item.entry.name,
      path: item.repoPath,
      branch: item.info.branch,
      isDirty: item.info.isDirty,
      dirtyCount: item.info.dirtyCount,
      lastCommitHash: item.info.lastCommitHash,
      lastCommitTime: item.info.lastCommitTime,
      lastCommitMsg: item.info.lastCommitMsg,
      lastScannedAt: now,
      lastError: '',
    });
    okCount++;
  }

  const total = dirs.length;
  const keep = inspected.map((item) => item.repoPath);
  if (keep.length === 0) {
    db.exec('DELETE FROM repos');
  } else {
    const ph = keep.map(() => '?').join(',');
    db.prepare(`DELETE FROM repos WHERE path NOT IN (${ph})`).run(...keep);
  }
  db.prepare('UPDATE scans SET finishedAt=?, total=?, okCount=?, failCount=? WHERE id=?').run(new Date().toISOString(), total, okCount, failCount, scanId);
  return { scanId, rootDir: root, total, okCount, failCount };
  } finally {
    setScanProgress({ running: false, current: '' });
  }
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
    db.prepare('UPDATE repos SET name=?, branch=?, isDirty=?, dirtyCount=?, lastCommitHash=?, lastCommitTime=?, lastCommitMsg=?, lastScannedAt=?, lastError=? WHERE path=?').run(row.name, row.branch, row.isDirty, row.dirtyCount, row.lastCommitHash, row.lastCommitTime, row.lastCommitMsg, row.lastScannedAt, row.lastError, row.path);
  } else {
    db.prepare('INSERT INTO repos(id, name, path, branch, isDirty, dirtyCount, lastCommitHash, lastCommitTime, lastCommitMsg, lastScannedAt, lastError) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(row.id, row.name, row.path, row.branch, row.isDirty, row.dirtyCount, row.lastCommitHash, row.lastCommitTime, row.lastCommitMsg, row.lastScannedAt, row.lastError);
  }
}
