import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

export type Repo = {
  id: string;
  name: string;
  path: string;
  branch: string;
  isDirty: number;
  dirtyCount: number;
  commitCount: number;
  commitsToday: number;
  commitsWeek: number;
  commitsMonth: number;
  lastCommitHash: string;
  lastCommitTime: string;
  lastCommitMsg: string;
  lastScannedAt: string;
  lastError: string;
  lastPullAt: string;
  lastPullMsg: string;
  remoteUrl: string;
  ahead: number | null;
  behind: number | null;
  language: string;
  sizeBytes: number;
  extrasTruncated: number;
};

export type Job = {
  id: string;
  repoId: string;
  prompt: string;
  status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
  logPath: string;
  exitCode: number | null;
  startedAt: string;
  finishedAt: string | null;
};

export type Scan = {
  id: number;
  rootDir: string;
  startedAt: string;
  finishedAt: string;
  total: number;
  okCount: number;
  failCount: number;
};

const SCHEMA_SQL = `CREATE TABLE IF NOT EXISTS repos(id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL UNIQUE, branch TEXT NOT NULL DEFAULT '', isDirty INTEGER NOT NULL DEFAULT 0, dirtyCount INTEGER NOT NULL DEFAULT 0, commitCount INTEGER NOT NULL DEFAULT 0, commitsToday INTEGER NOT NULL DEFAULT 0, commitsWeek INTEGER NOT NULL DEFAULT 0, commitsMonth INTEGER NOT NULL DEFAULT 0, lastCommitHash TEXT NOT NULL DEFAULT '', lastCommitTime TEXT NOT NULL DEFAULT '', lastCommitMsg TEXT NOT NULL DEFAULT '', lastScannedAt TEXT NOT NULL DEFAULT '', lastError TEXT NOT NULL DEFAULT '', lastPullAt TEXT NOT NULL DEFAULT '', lastPullMsg TEXT NOT NULL DEFAULT '', remoteUrl TEXT NOT NULL DEFAULT '', ahead INTEGER, behind INTEGER);
CREATE TABLE IF NOT EXISTS scans(id INTEGER PRIMARY KEY AUTOINCREMENT, rootDir TEXT NOT NULL, startedAt TEXT NOT NULL, finishedAt TEXT NOT NULL DEFAULT '', total INTEGER NOT NULL DEFAULT 0, okCount INTEGER NOT NULL DEFAULT 0, failCount INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY, repoId TEXT NOT NULL, prompt TEXT NOT NULL, status TEXT NOT NULL, logPath TEXT NOT NULL DEFAULT '', exitCode INTEGER, startedAt TEXT NOT NULL, finishedAt TEXT);`;

export function defaultDbPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'data', 'repoagent.db');
}

/** 現行 schema 版本。舊庫升級後據此觸發 commit 時間窗統計回填。 */
export const SCHEMA_VERSION = 1;

export function openDb(dbPath: string): DatabaseSync {
  if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(SCHEMA_SQL);
  migrateRepos(db);
  return db;
}

/** 舊庫是否尚未回填 commit 時間窗統計（回填後呼叫 markCommitStatsBackfilled 才會轉為 false）。 */
export function needsCommitStatsBackfill(db: DatabaseSync): boolean {
  const row = db.prepare('PRAGMA user_version').get() as { user_version?: number } | undefined;
  return Number(row?.user_version ?? 0) < SCHEMA_VERSION;
}

/** 標記 commit 時間窗統計已回填（或確認無需回填）。 */
export function markCommitStatsBackfilled(db: DatabaseSync): void {
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
}

/** 本 DB 最後一次掃描使用的 rootDir（無則空字串）；供舊庫回填決定要重掃哪個目錄。 */
export function lastScanRootDir(db: DatabaseSync): string {
  const row = db
    .prepare("SELECT rootDir FROM scans WHERE rootDir <> '' ORDER BY id DESC LIMIT 1")
    .get() as { rootDir?: string } | undefined;
  return row?.rootDir ?? '';
}

function migrateRepos(db: DatabaseSync) {
  const cols = db.prepare('PRAGMA table_info(repos)').all() as { name: string }[];
  const names = new Set(cols.map((c) => c.name));
  if (!names.has('lastPullAt')) db.exec("ALTER TABLE repos ADD COLUMN lastPullAt TEXT NOT NULL DEFAULT ''");
  if (!names.has('lastPullMsg')) db.exec("ALTER TABLE repos ADD COLUMN lastPullMsg TEXT NOT NULL DEFAULT ''");
  if (!names.has('remoteUrl')) db.exec("ALTER TABLE repos ADD COLUMN remoteUrl TEXT NOT NULL DEFAULT ''");
  if (!names.has('ahead')) db.exec('ALTER TABLE repos ADD COLUMN ahead INTEGER');
  if (!names.has('behind')) db.exec('ALTER TABLE repos ADD COLUMN behind INTEGER');
  if (!names.has('commitCount')) db.exec('ALTER TABLE repos ADD COLUMN commitCount INTEGER NOT NULL DEFAULT 0');
  if (!names.has('commitsToday')) db.exec('ALTER TABLE repos ADD COLUMN commitsToday INTEGER NOT NULL DEFAULT 0');
  if (!names.has('commitsWeek')) db.exec('ALTER TABLE repos ADD COLUMN commitsWeek INTEGER NOT NULL DEFAULT 0');
  if (!names.has('commitsMonth')) db.exec('ALTER TABLE repos ADD COLUMN commitsMonth INTEGER NOT NULL DEFAULT 0');
  if (!names.has('language')) db.exec("ALTER TABLE repos ADD COLUMN language TEXT NOT NULL DEFAULT ''");
  if (!names.has('sizeBytes')) db.exec('ALTER TABLE repos ADD COLUMN sizeBytes INTEGER NOT NULL DEFAULT 0');
  if (!names.has('extrasTruncated')) db.exec('ALTER TABLE repos ADD COLUMN extrasTruncated INTEGER NOT NULL DEFAULT 0');
}
