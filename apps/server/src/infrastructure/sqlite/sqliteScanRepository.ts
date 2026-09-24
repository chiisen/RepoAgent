/**
 * SqliteScanRepository — IScanRepository 實作。
 */
import type { DatabaseSync } from 'node:sqlite';

import type { IScanRepository } from '../../domain/ports.js';

export class SqliteScanRepository implements IScanRepository {
  constructor(private readonly db: DatabaseSync) {}

  create(rootDir: string, startedAt: string): number {
    const ins = this.db.prepare('INSERT INTO scans(rootDir, startedAt) VALUES (?, ?)');
    return Number(ins.run(rootDir, startedAt).lastInsertRowid);
  }

  finish(scanId: number, finishedAt: string, total: number, okCount: number, failCount: number): void {
    this.db
      .prepare('UPDATE scans SET finishedAt=?, total=?, okCount=?, failCount=? WHERE id=?')
      .run(finishedAt, total, okCount, failCount, scanId);
  }

  lastRootDir(): string {
    const row = this.db
      .prepare("SELECT rootDir FROM scans WHERE rootDir <> '' ORDER BY id DESC LIMIT 1")
      .get() as { rootDir?: string } | undefined;
    return row?.rootDir ?? '';
  }
}
