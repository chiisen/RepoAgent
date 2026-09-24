/**
 * @deprecated — 舊模組，新實作位於 `infrastructure/fs/extrasCollector.ts`。
 * 此檔保留僅為向後相容（測試 import）。
 */
export { collectExtras, EXTRAS_TIMEOUT_MS } from './_shims/extras.js';

export type { RepoExtras } from './domain/types.js';
