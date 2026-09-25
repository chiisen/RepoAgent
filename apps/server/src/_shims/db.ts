/**
 * Shim: db.ts — 舊 API 仍可呼叫，內部委派給新的 connection module。
 */
import type { DatabaseSync } from 'node:sqlite';

import {
  defaultDbPath as _defaultDbPath,
  lastScanRootDir as _lastScanRootDir,
  markCommitStatsBackfilled as _markCommitStatsBackfilled,
  needsCommitStatsBackfill as _needsCommitStatsBackfill,
  openConnection as _openConnection,
} from '../infrastructure/sqlite/connection.js';

export const defaultDbPath = _defaultDbPath;
export const SCHEMA_VERSION = 1;
export {
  _lastScanRootDir as lastScanRootDir,
  _markCommitStatsBackfilled as markCommitStatsBackfilled,
  _needsCommitStatsBackfill as needsCommitStatsBackfill,
};

/**
 * 舊 API：`openDb(dbPath)` 回傳 `DatabaseSync`。
 * 新模組回傳 `DatabaseConnection`，這裡 unwrap 回傳 raw DatabaseSync 以維持相容。
 */
export function openDb(dbPath: string): DatabaseSync {
  const conn = _openConnection(dbPath);
  return conn.raw() as DatabaseSync;
}
