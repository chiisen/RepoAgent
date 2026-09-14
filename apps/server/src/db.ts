import { DatabaseSync } from 'node:sqlite';

export type Repo = {
  id: string;
  name: string;
  path: string;
  branch: string;
  isDirty: number;
  dirtyCount: number;
  lastCommitHash: string;
  lastCommitTime: string;
  lastCommitMsg: string;
  lastScannedAt: string;
  lastError: string;
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

export function openDb(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec(
    `CREATE TABLE IF NOT EXISTS repos(id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL UNIQUE, branch TEXT NOT NULL DEFAULT '', isDirty INTEGER NOT NULL DEFAULT 0, dirtyCount INTEGER NOT NULL DEFAULT 0, lastCommitHash TEXT NOT NULL DEFAULT '', lastCommitTime TEXT NOT NULL DEFAULT '', lastCommitMsg TEXT NOT NULL DEFAULT '', lastScannedAt TEXT NOT NULL DEFAULT '', lastError TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS scans(id INTEGER PRIMARY KEY AUTOINCREMENT, rootDir TEXT NOT NULL, startedAt TEXT NOT NULL, finishedAt TEXT NOT NULL DEFAULT '', total INTEGER NOT NULL DEFAULT 0, okCount INTEGER NOT NULL DEFAULT 0, failCount INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY, repoId TEXT NOT NULL, prompt TEXT NOT NULL, status TEXT NOT NULL, logPath TEXT NOT NULL DEFAULT '', exitCode INTEGER, startedAt TEXT NOT NULL, finishedAt TEXT);`,
  );
  return db;
}
