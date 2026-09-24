/**
 * @deprecated — 舊模組，新實作位於 `infrastructure/sqlite/connection.ts`。
 * 此檔保留僅為向後相容（測試 import）。新代碼請改用 composition root。
 */
export {
  defaultDbPath,
  lastScanRootDir,
  markCommitStatsBackfilled,
  needsCommitStatsBackfill,
  openDb,
  SCHEMA_VERSION,
} from './_shims/db.js';

export type { Job, Repo, Scan } from './domain/types.js';
