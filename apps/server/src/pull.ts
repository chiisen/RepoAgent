/**
 * @deprecated — 舊模組，新實作位於 `infrastructure/git/childProcessPullExecutor.ts`。
 * 此檔保留僅為向後相容（測試 import）。
 */
export { lastOutputLine, PULL_TIMEOUT_MS, pullFastForward } from './_shims/pull.js';

export type { PullResult } from './domain/types.js';
