/**
 * Shim: scanner.ts — 保留舊匯出符號（scanRoot / refreshRepo / windowStart / getScanProgress）。
 *
 * 舊 API `scanRoot(db, ...)` 接受呼叫端的 db；委派給 composition 的 `createServicesForDb(db)`
 * 取得專屬 ScanService（其他 singleton 共用 container）。
 */
import type { DatabaseSync } from 'node:sqlite';
import { sharedContainer } from '../composition/_sharedContainer.js';
import { createServicesForDb } from '../composition/container.js';
import type { Repo } from '../domain/types.js';

/** 舊型別：ScanSummary / ScanProgress / CommitWindow（外部 API 形狀）。 */
export type ScanSummary = {
  scanId: number;
  rootDir: string;
  total: number;
  okCount: number;
  failCount: number;
};
export type ScanProgress = { running: boolean; total: number; done: number; current: string };
export type CommitWindow = 'today' | 'week' | 'month';

/** 舊 API：列出 rootDir 下的 git repo 寫入 db；回傳 ScanSummary。 */
export async function scanRoot(
  db: DatabaseSync,
  rootDir: string,
  onRepo?: (repo: Repo) => void,
): Promise<ScanSummary> {
  return createServicesForDb(db).scanService.scanRoot(rootDir, onRepo);
}

/** 對單一 repo 重掃。 */
export async function refreshRepo(db: DatabaseSync, repoPath: string, lastError = ''): Promise<void> {
  return createServicesForDb(db).scanService.refreshRepo(repoPath, lastError);
}

/** 對應舊 `getScanProgress()`：回傳目前 in-memory 進度（從 container 共享）。 */
export function getScanProgress(): ScanProgress {
  return sharedContainer().progress.get();
}

/** 對應舊 `windowStart(kind, now)`：今日/本週一/本月 1 號 ISO 字串。 */
export function windowStart(kind: CommitWindow, now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();
  if (kind === 'today') return new Date(y, m, d).toISOString();
  if (kind === 'week') return new Date(y, m, d - ((now.getDay() + 6) % 7)).toISOString();
  return new Date(y, m, 1).toISOString();
}

export function getSkipDirs(): Set<string> {
  const snap = sharedContainer().configRepo.snapshot();
  const extra = Array.isArray(snap.skipDirs) ? snap.skipDirs : ['node_modules', '.superpowers'];
  return new Set(['.git', ...extra.map((s) => String(s).toLowerCase())]);
}

export function getScanRecursive(): boolean {
  return sharedContainer().configRepo.snapshot().scanRecursive === true;
}

export function getScanDepth(): number {
  const n = Number(sharedContainer().configRepo.snapshot().scanDepth);
  if (!Number.isInteger(n) || n < 1 || n > 5) return 3;
  return n;
}
