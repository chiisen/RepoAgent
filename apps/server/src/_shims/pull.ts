/**
 * Shim: pull.ts — 保留舊 `pullFastForward` export。
 */

import { sharedContainer } from '../composition/_sharedContainer.js';
import type { PullResult } from '../domain/types.js';

export const PULL_TIMEOUT_MS = 25_000;

export type { PullResult };

export async function pullFastForward(repoPath: string, jobId: string): Promise<PullResult> {
  return sharedContainer().pullExecutor.pullFastForward(repoPath, jobId);
}

export function lastOutputLine(text: string): string {
  const lines = text
    .replace(/\r/g, '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  return (lines[lines.length - 1] || text.trim() || '').slice(0, 200);
}
