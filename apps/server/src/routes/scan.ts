/**
 * @deprecated — 保留舊 `createScanRouter(db)` 簽名（測試相容）。
 */
import type { DatabaseSync } from 'node:sqlite';

import { createServicesForDb } from '../composition/container.js';
import { createScanRouter as _newCreateScanRouter } from './_internal/scan.js';

export function createScanRouter(db: DatabaseSync): ReturnType<typeof _newCreateScanRouter> {
  const services = createServicesForDb(db);
  return _newCreateScanRouter(services.scanService, services.progress);
}
