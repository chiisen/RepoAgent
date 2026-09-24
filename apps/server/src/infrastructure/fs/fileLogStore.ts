/**
 * FsFileLogStore — IFileLogStore 實作。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import type { IFileLogStore } from '../../domain/ports.js';

export const MAX_JOB_LOGS = 50;

export class FsFileLogStore implements IFileLogStore {
  writeJobLog(logPath: string, line: string): void {
    try {
      fs.appendFileSync(logPath, `${line}\n`);
    } catch {
      /* log 寫失敗不影響主流程 */
    }
  }

  appendJobLog(logPath: string, line: string): void {
    this.writeJobLog(logPath, line);
  }

  ensureLogFile(logPath: string): void {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.writeFileSync(logPath, '');
  }

  prune(dir: string, keep = MAX_JOB_LOGS): { kept: number; deleted: number } {
    let files: string[];
    try {
      files = fs.readdirSync(dir).filter((f) => f.endsWith('.log'));
    } catch {
      return { kept: 0, deleted: 0 };
    }
    if (files.length <= keep) return { kept: files.length, deleted: 0 };
    const withTime = files.map((f) => {
      let mtimeMs = 0;
      try {
        mtimeMs = fs.statSync(path.join(dir, f)).mtimeMs;
      } catch {
        /* 競刪視為最舊 */
      }
      return { f, mtimeMs };
    });
    withTime.sort((a, b) => b.mtimeMs - a.mtimeMs || (a.f < b.f ? -1 : 1));
    let deleted = 0;
    for (const { f } of withTime.slice(keep)) {
      try {
        fs.rmSync(path.join(dir, f), { force: true });
        deleted++;
      } catch {
        /* 單檔清失敗不中斷 */
      }
    }
    return { kept: files.length - deleted, deleted };
  }
}
