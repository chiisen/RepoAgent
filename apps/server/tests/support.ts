/**
 * 測試接線：打開呼叫端自己的 db，並用 composition 組出該 db 的服務。
 * 正式程式沒有這層。
 */
import type { ChildProcess } from 'node:child_process';
import type { DatabaseSync } from 'node:sqlite';
import {
  JOB_DEFAULT_TIMEOUT_MS,
  JOB_HEARTBEAT_MS,
  JOB_KILL_GRACE_MS,
} from '../src/application/jobService.js';
import { sharedContainer } from '../src/composition/_sharedContainer.js';
import { createServicesForDb } from '../src/composition/container.js';
import type { ConfigStore } from '../src/domain/config.js';
import type { RepoCallback } from '../src/domain/ports.js';
import type { JobRecord } from '../src/domain/types.js';
import { MAX_JOB_LOGS } from '../src/infrastructure/fs/fileLogStore.js';
import { openConnection } from '../src/infrastructure/sqlite/connection.js';
import { createJobsRouter as newJobsRouter } from '../src/routes/_internal/jobs.js';
import { createReposRouter as newReposRouter } from '../src/routes/_internal/repos.js';
import { createScanRouter as newScanRouter } from '../src/routes/_internal/scan.js';

export const JOB_TIMEOUT_MS = JOB_DEFAULT_TIMEOUT_MS;
export const KILL_GRACE_MS = JOB_KILL_GRACE_MS;
export const HEARTBEAT_MS = JOB_HEARTBEAT_MS;

export function openDb(dbPath: string): DatabaseSync {
  return openConnection(dbPath).raw() as DatabaseSync;
}

export function servicesFor(db: DatabaseSync) {
  return createServicesForDb(db);
}

export function scanRoot(db: DatabaseSync, rootDir: string, onRepo?: RepoCallback) {
  return createServicesForDb(db).scanService.scanRoot(rootDir, onRepo);
}

export function reposRouter(db: DatabaseSync) {
  return newReposRouter(createServicesForDb(db).repoService);
}

export function scanRouter(db: DatabaseSync) {
  return newScanRouter(createServicesForDb(db).scanService, createServicesForDb(db).progress);
}

export function jobsRouter(db: DatabaseSync) {
  return newJobsRouter(createServicesForDb(db).jobService);
}

/** 測試改共享設定。寫入走 configRepo.patch，讀取走 snapshot。 */
export const configStore: ConfigStore = new Proxy({} as ConfigStore, {
  get(_target, prop) {
    return Reflect.get(sharedContainer().configRepo.snapshot(), prop);
  },
  set(_target, prop, value) {
    sharedContainer().configRepo.patch({ [prop as string]: value });
    return true;
  },
});

export function initOptimizer(io: { clients?: Iterable<unknown> } | null, _db?: unknown): void {
  const container = sharedContainer();
  container.broadcaster.attach(io);
  container.jobService.reset();
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

export function getActiveJob(): JobRecord | undefined {
  return listActiveJobs()[0];
}

export function getJobStatus(jobId: string): JobRecord | undefined {
  return sharedContainer().jobRegistry.get(jobId);
}

export function getPiConcurrency(): number {
  return sharedContainer().jobService.piConcurrency();
}

export function getJobTimeoutMs(): number {
  return sharedContainer().jobService.jobTimeoutMs();
}

export function pruneJobLogs(dir: string, keep = MAX_JOB_LOGS) {
  return sharedContainer().logStore.prune(dir, keep);
}

export function getScanProgress() {
  return sharedContainer().progress.get();
}

export function pullFastForward(repoPath: string, jobId: string) {
  return sharedContainer().pullExecutor.pullFastForward(repoPath, jobId);
}

export function getPiHeartbeat(sinceIso: string) {
  return sharedContainer().heartbeatService.get(sinceIso);
}

function activeJobs(): Map<string, JobRecord> {
  const fresh = new Map<string, JobRecord>();
  for (const job of sharedContainer().jobRegistry.listActive()) fresh.set(job.id, job);
  return fresh;
}

export const jobMap: Map<string, JobRecord> = new Proxy(new Map<string, JobRecord>(), {
  get(_target, prop, _receiver) {
    const fresh = activeJobs();
    const value = Reflect.get(fresh, prop, fresh);
    return typeof value === 'function' ? value.bind(fresh) : value;
  },
});

export const childMap: Map<string, ChildProcess> = new Proxy(new Map<string, ChildProcess>(), {
  get(_target, prop, _receiver) {
    const fresh = new Map<string, ChildProcess>();
    for (const job of sharedContainer().jobRegistry.listActive()) {
      const child = sharedContainer().jobRegistry.getChild(job.id);
      if (child) fresh.set(job.id, child);
    }
    const value = Reflect.get(fresh, prop, fresh);
    return typeof value === 'function' ? value.bind(fresh) : value;
  },
});
