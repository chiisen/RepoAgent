import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { openDb, needsCommitStatsBackfill, markCommitStatsBackfilled, lastScanRootDir } from '../src/db.js';

describe('db schema', () => {
  it('creates repos, scans, jobs tables', () => {
    const db = openDb(':memory:');
    try {
      const rows = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('repos','scans','jobs')")
        .all() as { name: string }[];
      const names = rows.map((r) => r.name).sort();
      expect(names).toEqual(['jobs', 'repos', 'scans']);
    } finally {
      db.close();
    }
  });

  it('enforces UNIQUE constraint on repos.path', () => {
    const db = openDb(':memory:');
    try {
      db.prepare("INSERT INTO repos (id, name, path) VALUES ('1', 'a', '/tmp/repo-a')").run();
      expect(() =>
        db.prepare("INSERT INTO repos (id, name, path) VALUES ('2', 'b', '/tmp/repo-a')").run(),
      ).toThrow();
    } finally {
      db.close();
    }
  });

  it('舊庫缺 commit 時間窗欄位時補上，並標記需回填一次', () => {
    const dir = mkdtempSync(join(tmpdir(), 'repoagent-db-'));
    const p = join(dir, 'old.db');
    try {
      const old = new DatabaseSync(p);
      old.exec(
        "CREATE TABLE repos(id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL UNIQUE, branch TEXT NOT NULL DEFAULT '', isDirty INTEGER NOT NULL DEFAULT 0, dirtyCount INTEGER NOT NULL DEFAULT 0, lastCommitHash TEXT NOT NULL DEFAULT '', lastCommitTime TEXT NOT NULL DEFAULT '', lastCommitMsg TEXT NOT NULL DEFAULT '', lastScannedAt TEXT NOT NULL DEFAULT '', lastError TEXT NOT NULL DEFAULT '')",
      );
      old.prepare("INSERT INTO repos(id, name, path) VALUES('1', 'a', '/tmp/a')").run();
      old.close();

      const db = openDb(p);
      try {
        const cols = (db.prepare('PRAGMA table_info(repos)').all() as { name: string }[]).map((c) => c.name);
        expect(cols).toContain('commitsToday');
        expect(needsCommitStatsBackfill(db)).toBe(true);
        markCommitStatsBackfilled(db);
        expect(needsCommitStatsBackfill(db)).toBe(false);
      } finally {
        db.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('lastScanRootDir 取本 DB 最後一筆掃描目錄', () => {
    const db = openDb(':memory:');
    try {
      expect(lastScanRootDir(db)).toBe('');
      db.prepare("INSERT INTO scans(rootDir, startedAt) VALUES('D:/a', '2026-01-01')").run();
      db.prepare("INSERT INTO scans(rootDir, startedAt) VALUES('D:/b', '2026-01-02')").run();
      expect(lastScanRootDir(db)).toBe('D:/b');
    } finally {
      db.close();
    }
  });
});
