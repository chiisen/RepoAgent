/**
 * @deprecated — 舊模組，新實作位於 `infrastructure/fs/piSessionHeartbeatProbe.ts`。
 * 此檔保留僅為向後相容（測試 import）。
 */
export { getPiHeartbeat, parseSessionStart, sessionRoot } from './_shims/piHeartbeat.js';

export type { PiHeartbeat } from './domain/types.js';
