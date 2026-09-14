import { describe, expect, it } from 'vitest';
import { openDb } from '../src/db.js';

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
});
