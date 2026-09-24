/**
 * @deprecated — 舊模組，新實作位於 `application/scanService.ts`。
 * 此檔保留僅為向後相容（測試 import）。
 */

export type { CommitWindow, ScanProgress, ScanSummary } from './_shims/scanner.js';
export {
  getScanDepth,
  getScanProgress,
  getScanRecursive,
  getSkipDirs,
  refreshRepo,
  scanRoot,
  windowStart,
} from './_shims/scanner.js';
