/**
 * SQLite connection — schema、migration、connection factory。
 */
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

import type { IDatabaseConnection } from '../../domain/ports.js';

export const SCHEMA_VERSION = 1;

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS repos(
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  path TEXT NOT NULL UNIQUE,
  branch TEXT NOT NULL DEFAULT '',
  isDirty INTEGER NOT NULL DEFAULT 0,
  dirtyCount INTEGER NOT NULL DEFAULT 0,
  commitCount INTEGER NOT NULL DEFAULT 0,
  commitsToday INTEGER NOT NULL DEFAULT 0,
  commitsWeek INTEGER NOT NULL DEFAULT 0,
  commitsMonth INTEGER NOT NULL DEFAULT 0,
  lastCommitHash TEXT NOT NULL DEFAULT '',
  lastCommitTime TEXT NOT NULL DEFAULT '',
  lastCommitMsg TEXT NOT NULL DEFAULT '',
  lastScannedAt TEXT NOT NULL DEFAULT '',
  lastError TEXT NOT NULL DEFAULT '',
  lastPullAt TEXT NOT NULL DEFAULT '',
  lastPullMsg TEXT NOT NULL DEFAULT '',
  remoteUrl TEXT NOT NULL DEFAULT '',
  ahead INTEGER,
  behind INTEGER,
  language TEXT NOT NULL DEFAULT '',
  sizeBytes INTEGER NOT NULL DEFAULT 0,
  extrasTruncated INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS scans(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rootDir TEXT NOT NULL,
  startedAt TEXT NOT NULL,
  finishedAt TEXT NOT NULL DEFAULT '',
  total INTEGER NOT NULL DEFAULT 0,
  okCount INTEGER NOT NULL DEFAULT 0,
  failCount INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS jobs(
  id TEXT PRIMARY KEY,
  repoId TEXT NOT NULL,
  prompt TEXT NOT NULL,
  status TEXT NOT NULL,
  logPath TEXT NOT NULL DEFAULT '',
  exitCode INTEGER,
  startedAt TEXT NOT NULL,
  finishedAt TEXT
);
`;

export function defaultDbPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'data', 'repoagent.db');
}

function migrateRepos(db: DatabaseSync): void {
  const cols = db.prepare('PRAGMA table_info(repos)').all() as { name: string }[];
  const names = new Set(cols.map((c) => c.name));
  const adds: { col: string; ddl: string }[] = [
    { col: 'lastPullAt', ddl: "ALTER TABLE repos ADD COLUMN lastPullAt TEXT NOT NULL DEFAULT ''" },
    { col: 'lastPullMsg', ddl: "ALTER TABLE repos ADD COLUMN lastPullMsg TEXT NOT NULL DEFAULT ''" },
    { col: 'remoteUrl', ddl: "ALTER TABLE repos ADD COLUMN remoteUrl TEXT NOT NULL DEFAULT ''" },
    { col: 'ahead', ddl: 'ALTER TABLE repos ADD COLUMN ahead INTEGER' },
    { col: 'behind', ddl: 'ALTER TABLE repos ADD COLUMN behind INTEGER' },
    { col: 'commitCount', ddl: 'ALTER TABLE repos ADD COLUMN commitCount INTEGER NOT NULL DEFAULT 0' },
    { col: 'commitsToday', ddl: 'ALTER TABLE repos ADD COLUMN commitsToday INTEGER NOT NULL DEFAULT 0' },
    { col: 'commitsWeek', ddl: 'ALTER TABLE repos ADD COLUMN commitsWeek INTEGER NOT NULL DEFAULT 0' },
    { col: 'commitsMonth', ddl: 'ALTER TABLE repos ADD COLUMN commitsMonth INTEGER NOT NULL DEFAULT 0' },
    { col: 'language', ddl: "ALTER TABLE repos ADD COLUMN language TEXT NOT NULL DEFAULT ''" },
    { col: 'sizeBytes', ddl: 'ALTER TABLE repos ADD COLUMN sizeBytes INTEGER NOT NULL DEFAULT 0' },
    {
      col: 'extrasTruncated',
      ddl: 'ALTER TABLE repos ADD COLUMN extrasTruncated INTEGER NOT NULL DEFAULT 0',
    },
  ];
  for (const { col, ddl } of adds) {
    if (!names.has(col)) db.exec(ddl);
  }
}

class DatabaseConnection implements IDatabaseConnection {
  constructor(private readonly db: DatabaseSync) {}

  raw(): DatabaseSync {
    return this.db;
  }

  close(): void {
    try {
      this.db.close();
    } catch {
      /* 已關閉略過 */
    }
  }
}

export function openConnection(dbPath: string): DatabaseConnection {
  if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(SCHEMA_SQL);
  migrateRepos(db);
  return new DatabaseConnection(db);
}

/** 舊庫升級用：是否尚未做 commit 時間窗統計回填。 */
export function needsCommitStatsBackfill(db: DatabaseSync): boolean {
  const row = db.prepare('PRAGMA user_version').get() as { user_version?: number } | undefined;
  return Number(row?.user_version ?? 0) < SCHEMA_VERSION;
}

/** 標記 commit 時間窗統計已回填。 */
export function markCommitStatsBackfilled(db: DatabaseSync): void {
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
}

/** 最後一次掃描使用的 rootDir；無則空字串。 */
export function lastScanRootDir(db: DatabaseSync): string {
  const row = db.prepare("SELECT rootDir FROM scans WHERE rootDir <> '' ORDER BY id DESC LIMIT 1").get() as
    | { rootDir?: string }
    | undefined;
  return row?.rootDir ?? '';
}
