/**
 * Shim: pull.ts — 保留舊 `pullFastForward` export。
 */

import { sharedContainer } from '../composition/_sharedContainer.js';
import { lastOutputLine } from '../domain/text.js';
import type { PullResult } from '../domain/types.js';
import { PULL_TIMEOUT_MS } from '../infrastructure/git/childProcessPullExecutor.js';

export type { PullResult };
export { lastOutputLine, PULL_TIMEOUT_MS };

export async function pullFastForward(repoPath: string, jobId: string): Promise<PullResult> {
  return sharedContainer().pullExecutor.pullFastForward(repoPath, jobId);
}
