/**
 * @deprecated — 保留舊 `createReposRouter(db)` 簽名（測試相容）。
 * 內部委派給 composition container 的 `createServicesForDb(db)`。
 */
import type { DatabaseSync } from 'node:sqlite';

import { createServicesForDb } from '../composition/container.js';
import { createReposRouter as _newCreateReposRouter } from './_internal/repos.js';
import { _setSharedDb } from './jobs.js';

export function createReposRouter(db: DatabaseSync): ReturnType<typeof _newCreateReposRouter> {
  _setSharedDb(db);
  const services = createServicesForDb(db);
  return _newCreateReposRouter(services.repoService);
}
