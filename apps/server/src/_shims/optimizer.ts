/**
 * Shim: optimizer.ts — 保留舊 module-level exports（initOptimizer / createJob / startJob / ...）。
 *
 * 對舊測試的對應：
 * - `initOptimizer(wss, db)`：重置 registry + attach broadcaster
 * - `createJob(repoId, prompt)`：建立並加入 registry
 * - `startJob(job, db)`：呼叫 JobService.startJob
 * - `cancelJob(jobId)`：呼叫 JobService.cancel
 * - `getActiveJob / getJobStatus / listActiveJobs / getActiveJobForRepo`：委派
 * - `getPiConcurrency / getJobTimeoutMs`：委派
 * - `jobMap / childMap`：保留為 Map（測試可呼叫 .clear()、 .values()）
 * - `JOB_TIMEOUT_MS / KILL_GRACE_MS / HEARTBEAT_MS`：固定常數（舊值）
 * - `pruneJobLogs(dir, keep)`：委派給 logStore
 * - `MAX_JOB_LOGS`：常數
 * - `notifyEvent(type, payload)`：透過 broadcaster
 */
import type { Server } from 'ws';

import {
  JOB_DEFAULT_TIMEOUT_MS,
  JOB_HEARTBEAT_MS,
  JOB_KILL_GRACE_MS,
  JobService,
} from '../application/jobService.js';
import { sharedContainer } from '../composition/_sharedContainer.js';
import type { JobDiff, JobDiffState, JobRecord, JobStatus } from '../domain/types.js';
import { MAX_JOB_LOGS } from '../infrastructure/fs/fileLogStore.js';

export { MAX_JOB_LOGS };

// 公開的「常數」與「Map」
export const JOB_TIMEOUT_MS = JOB_DEFAULT_TIMEOUT_MS;
export const KILL_GRACE_MS = JOB_KILL_GRACE_MS;
export const HEARTBEAT_MS = JOB_HEARTBEAT_MS;

/** Proxy Map 委託給 container.jobRegistry（測試可呼叫 .clear() / .get()）。 */
function wrapJobMap(): Map<string, JobRecord> {
  type JobMapLike = Map<string, JobRecord> & { __proxy?: boolean };
  const m = new Map<string, JobRecord>() as JobMapLike;
  m.__proxy = true;
  return new Proxy(m, {
    get(_target, prop, _receiver) {
      const reg = sharedContainer().jobRegistry;
      const fresh = new Map<string, JobRecord>();
      for (const j of reg.listActive()) fresh.set(j.id, j);
      const value = Reflect.get(fresh, prop, fresh);
      return typeof value === 'function' ? value.bind(fresh) : value;
    },
    has(_target, prop) {
      const reg = sharedContainer().jobRegistry;
      return reg.listActive().some((j) => j.id === String(prop));
    },
  }) as JobMapLike;
}

function wrapChildMap(): Map<string, import('node:child_process').ChildProcess> {
  type ChildMapLike = Map<string, import('node:child_process').ChildProcess> & { __proxy?: boolean };
  const m = new Map<string, import('node:child_process').ChildProcess>() as ChildMapLike;
  m.__proxy = true;
  return new Proxy(m, {
    get(_target, prop, _receiver) {
      const reg = sharedContainer().jobRegistry;
      const fresh = new Map<string, import('node:child_process').ChildProcess>();
      for (const id of reg.listActive().map((j) => j.id)) {
        const c = reg.getChild(id);
        if (c) fresh.set(id, c);
      }
      const value = Reflect.get(fresh, prop, fresh);
      return typeof value === 'function' ? value.bind(fresh) : value;
    },
    has(_target, prop) {
      const reg = sharedContainer().jobRegistry;
      const id = String(prop);
      return reg.listActive().some((j) => j.id === id) && reg.getChild(id) !== undefined;
    },
  }) as ChildMapLike;
}

export const jobMap = wrapJobMap();
export const childMap = wrapChildMap();

/** 初始化：把 ws server attach、清除殘留狀態。 */
export function initOptimizer(
  io: Server | { emit: (e: string, p: unknown) => void } | null,
  _db: unknown,
): void {
  const container = sharedContainer();
  container.broadcaster.attach(io as { clients?: Iterable<unknown> });
  container.jobService.reset();
}

export function notifyEvent(
  type: 'job:log' | 'job:done' | 'scan:done' | 'scan:repo',
  payload: Record<string, unknown>,
): void {
  const container = sharedContainer();
  container.broadcaster.broadcast({ type, ...payload } as never);
}

export function getPiConcurrency(): number {
  return sharedContainer().jobService.piConcurrency();
}

export function getJobTimeoutMs(): number {
  return sharedContainer().jobService.jobTimeoutMs();
}

export function createJob(repoId: string, prompt: string): JobRecord {
  return sharedContainer().jobRegistry.create(repoId, prompt);
}

export function startJob(job: JobRecord, _db?: unknown): Promise<void> {
  return sharedContainer().jobService.startJob(job);
}

export function cancelJob(jobId: string): void {
  sharedContainer().jobService.cancel(jobId);
}

export function listActiveJobs(): JobRecord[] {
  return sharedContainer().jobRegistry.listActive();
}

export function getActiveJobForRepo(repoPath: string): JobRecord | undefined {
  return sharedContainer().jobRegistry.activeForRepo(repoPath);
}

export function getActiveJob(): JobRecord | undefined {
  return listActiveJobs()[0];
}

export function getJobStatus(jobId: string): JobRecord | undefined {
  return sharedContainer().jobRegistry.get(jobId);
}

export function pruneJobLogs(dir: string, keep = MAX_JOB_LOGS): { kept: number; deleted: number } {
  return sharedContainer().logStore.prune(dir, keep);
}

// 給 optimizer.test.ts 的 JobStatus type alias
export type { JobDiff, JobDiffState, JobStatus };

// 給 optimizer.test.ts import 的 _app.ts 內 service
export { JobService };
