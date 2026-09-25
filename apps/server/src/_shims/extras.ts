/**
 * Shim: extras.ts — 保留舊 `collectExtras` / `EXTRAS_TIMEOUT_MS` / `RepoExtras`。
 */

export type { RepoExtras } from '../domain/types.js';
export { collectExtras, EXTRAS_TIMEOUT_MS } from '../infrastructure/fs/extrasCollector.js';
