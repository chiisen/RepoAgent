import { readdirSync, existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { simpleGit } from 'simple-git';
import type { Repo } from './db.js';
import { configStore, normalizeRootDir } from './config.js';
import { collectExtras, EXTRAS_TIMEOUT_MS } from './extras.js';

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

const ALWAYS_SKIP = new Set(['.git']);

export function getSkipDirs(): Set<string> {
  const extra = Array.isArray(configStore.skipDirs) ? configStore.skipDirs : ['node_modules', '.superpowers'];
  return new Set([...ALWAYS_SKIP, ...extra.map((s) => String(s).toLowerCase())]);
}
const GIT_TIMEOUT_MS = 12_000;
const SCAN_CONCURRENCY = 6;
const MAX_SCAN_DEPTH = 5;

export function getScanRecursive(): boolean {
  return configStore.scanRecursive === true;
}

export function getScanDepth(): number {
  const n = Number(configStore.scanDepth);
  if (!Number.isInteger(n) || n < 1 || n > MAX_SCAN_DEPTH) return 3;
  return n;
}

/** 列出 git 專案路徑。recursive=false 或 depth=1 時與 V1 相同（只掃下一層）。 */
export function listGitRepos(
  root: string,
  recursive = false,
  maxDepth = 1,
): { path: string; name: string }[] {
  const depthCap = recursive ? Math.min(Math.max(1, maxDepth), MAX_SCAN_DEPTH) : 1;
  const out: { path: string; name: string }[] = [];
  const walk = (dir: string, depth: number, rel: string) => {
    let entries: ReturnType<typeof readdirSync>;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || getSkipDirs().has(entry.name.toLowerCase())) continue;
      const p = join(dir, entry.name);
      const name = rel ? rel + '/' + entry.name : entry.name;
      if (existsSync(join(p, '.git'))) {
        out.push({ path: p, name });
        continue;
      }
      if (depth < depthCap) walk(p, depth + 1, name);
    }
  };
  walk(root, 1, '');
  return out;
}

// 規格 §4.2：掃描的 git 子進程不得等待憑證輸入。
// simple-git 3.36 的構造參數 spawnOptions 僅支援 uid/gid（傳 env 會被靜默忽略），
// 而 .env() 會整組取代子進程 env 並觸發 unsafe 守衛（如 PAGER），故改以 process.env
// 預設值讓子進程自然繼承；同事先設定的值不受影響。
for (const [k, v] of Object.entries({
  GIT_TERMINAL_PROMPT: '0',
  GCM_INTERACTIVE: 'never',
  GIT_OPTIONAL_LOCKS: '0',
} as const)) {
  process.env[k] ??= v;
}

function gitClient(repoPath: string) {
  return simpleGit(repoPath, {
    timeout: { block: GIT_TIMEOUT_MS },
  });
}

export async function refreshRepo(db: DatabaseSync, repoPath: string, lastError = ''): Promise<void> {
  const now = new Date().toISOString();
  const name = basename(repoPath);
  try {
    const info = await inspectRepo(repoPath);
    const id = await repoId(db, repoPath);
    const extras = configStore.extrasEnabled ? collectExtras(repoPath, getSkipDirs(), EXTRAS_TIMEOUT_MS) : null;
    upsertRepo(db, {
      id,
      name,
      path: repoPath,
      branch: info.branch,
      isDirty: info.isDirty,
      dirtyCount: info.dirtyCount,
      lastCommitHash: info.lastCommitHash,
      lastCommitTime: info.lastCommitTime,
      lastCommitMsg: info.lastCommitMsg,
      lastScannedAt: now,
      lastError,
      lastPullAt: '',
      lastPullMsg: '',
      remoteUrl: info.remoteUrl,
      ahead: info.ahead,
      behind: info.behind,
      language: extras?.language ?? '',
      sizeBytes: extras?.sizeBytes ?? 0,
      extrasTruncated: extras?.truncated ? 1 : 0,
    }, Boolean(extras));
  } catch (e) {
    const id = await repoId(db, repoPath);
    db.prepare('UPDATE repos SET name=?, lastScannedAt=?, lastError=? WHERE id=?').run(
      name,
      now,
      lastError || String(e).slice(0, 300),
      id,
    );
  }
}

async function inspectRepo(repoPath: string): Promise<{
  branch: string;
  isDirty: number;
  dirtyCount: number;
  lastCommitHash: string;
  lastCommitTime: string;
  lastCommitMsg: string;
  remoteUrl: string;
  ahead: number | null;
  behind: number | null;
}> {
  const git = gitClient(repoPath);
  const [branchRaw, porcelain, logOut, remoteUrl, countsRaw] = await Promise.all([
    git.raw(['rev-parse', '--abbrev-ref', 'HEAD']).catch(() => ''),
    git.raw(['status', '--porcelain=v1']),
    git.raw(['log', '-1', '--format=%H%x09%aI%x09%s']).catch(() => ''),
    git.raw(['remote', 'get-url', 'origin']).catch(async () => {
      const names = (await git.raw(['remote']).catch(() => '')).trim().split(/\r?\n/).filter(Boolean);
      if (!names[0]) return '';
      return git.raw(['remote', 'get-url', names[0]]).catch(() => '');
    }),
    git.raw(['rev-list', '--left-right', '--count', '@{upstream}...HEAD']).catch(() => ''),
  ]);
  const dirtyLines = porcelain.split(/\r?\n/).filter((l) => l.length > 0);
  const [hash = '', time = '', ...msg] = logOut.trim().split('\t');
  const parts = countsRaw.trim().split(/\s+/);
  const behind = parts.length >= 2 && parts[0] !== '' ? Number(parts[0]) : null;
  const ahead = parts.length >= 2 && parts[1] !== '' ? Number(parts[1]) : null;
  return {
    branch: branchRaw.trim(),
    isDirty: dirtyLines.length > 0 ? 1 : 0,
    dirtyCount: dirtyLines.length,
    lastCommitHash: hash,
    lastCommitTime: time,
    lastCommitMsg: msg.join('\t').trim(),
    remoteUrl: String(remoteUrl).trim(),
    ahead: ahead !== null && Number.isFinite(ahead) ? ahead : null,
    behind: behind !== null && Number.isFinite(behind) ? behind : null,
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
  const root = normalizeRootDir(rootDir);
  if (!existsSync(root)) throw new Error(`rootDir not found: ${root}`);
  setScanProgress({ running: true, total: 0, done: 0, current: '列目錄…' });
  try {
  const startedAt = new Date().toISOString();
  const ins = db.prepare('INSERT INTO scans(rootDir, startedAt) VALUES (?, ?)');
  const r = ins.run(root, startedAt);
  const scanId = Number(r.lastInsertRowid);

  const dirs = listGitRepos(root, getScanRecursive(), getScanDepth());
  setScanProgress({ total: dirs.length, current: dirs.length ? '' : '無 git 專案' });

  const inspected = await mapPool(dirs, SCAN_CONCURRENCY, async (entry) => {
    const repoPath = entry.path;
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
    const extras = configStore.extrasEnabled ? collectExtras(item.repoPath, getSkipDirs(), EXTRAS_TIMEOUT_MS) : null;
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
      lastPullAt: '',
      lastPullMsg: '',
      remoteUrl: item.info.remoteUrl,
      ahead: item.info.ahead,
      behind: item.info.behind,
      language: extras?.language ?? '',
      sizeBytes: extras?.sizeBytes ?? 0,
      extrasTruncated: extras?.truncated ? 1 : 0,
    }, Boolean(extras));
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

function upsertRepo(db: DatabaseSync, row: Repo, writeExtras = false) {
  const has = db.prepare('SELECT 1 FROM repos WHERE path=?').get(row.path);
  if (has) {
    db.prepare('UPDATE repos SET name=?, branch=?, isDirty=?, dirtyCount=?, lastCommitHash=?, lastCommitTime=?, lastCommitMsg=?, lastScannedAt=?, lastError=?, remoteUrl=?, ahead=?, behind=? WHERE path=?').run(row.name, row.branch, row.isDirty, row.dirtyCount, row.lastCommitHash, row.lastCommitTime, row.lastCommitMsg, row.lastScannedAt, row.lastError, row.remoteUrl, row.ahead, row.behind, row.path);
    if (writeExtras) {
      db.prepare('UPDATE repos SET language=?, sizeBytes=?, extrasTruncated=? WHERE path=?').run(
        row.language || '',
        row.sizeBytes || 0,
        row.extrasTruncated || 0,
        row.path,
      );
    }
  } else {
    db.prepare('INSERT INTO repos(id, name, path, branch, isDirty, dirtyCount, lastCommitHash, lastCommitTime, lastCommitMsg, lastScannedAt, lastError, remoteUrl, ahead, behind, language, sizeBytes, extrasTruncated) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(row.id, row.name, row.path, row.branch, row.isDirty, row.dirtyCount, row.lastCommitHash, row.lastCommitTime, row.lastCommitMsg, row.lastScannedAt, row.lastError, row.remoteUrl, row.ahead, row.behind, writeExtras ? row.language || '' : '', writeExtras ? row.sizeBytes || 0 : 0, writeExtras ? row.extrasTruncated || 0 : 0);
  }
}
