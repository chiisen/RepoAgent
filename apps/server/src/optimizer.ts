/**
 * @deprecated — 舊模組，新實作位於 `application/jobService.ts` + `application/jobRegistry.ts`。
 * 此檔保留僅為向後相容（測試 import）。
 */
export {
  cancelJob,
  childMap,
  createJob,
  getActiveJob,
  getActiveJobForRepo,
  getJobStatus,
  getJobTimeoutMs,
  getPiConcurrency,
  HEARTBEAT_MS,
  initOptimizer,
  JOB_TIMEOUT_MS,
  JobService,
  jobMap,
  KILL_GRACE_MS,
  listActiveJobs,
  MAX_JOB_LOGS,
  notifyEvent,
  pruneJobLogs,
  startJob,
} from './_shims/optimizer.js';

export type { JobDiff, JobDiffState, JobRecord, JobStatus } from './domain/types.js';
