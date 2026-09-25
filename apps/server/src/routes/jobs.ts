/**
 * @deprecated — 保留舊 `createJobsRouter()` 簽名（測試相容）。
 */
import type { DatabaseSync } from 'node:sqlite';
import { sharedContainer } from '../composition/_sharedContainer.js';
import { createServicesForDb } from '../composition/container.js';
import { createJobsRouter as _newCreateJobsRouter } from './_internal/jobs.js';

let sharedDb: DatabaseSync | null = null;
/** 測試 setter（createReposRouter 會呼叫，讓後續 createJobsRouter 共用同一個 db）。 */
export function _setSharedDb(db: DatabaseSync | null): void {
  sharedDb = db;
}

export function createJobsRouter(): ReturnType<typeof _newCreateJobsRouter> {
  // 若曾由 createReposRouter 設過 sharedDb，沿用；否則用 container 的 db。
  const db = sharedDb ?? (sharedContainer().db as DatabaseSync);
  const services = createServicesForDb(db);
  return _newCreateJobsRouter(services.jobService);
}
