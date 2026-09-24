/**
 * Domain — WebSocket 事件型別與 payload 定義（type-safe）。
 */
import type { JobRecord, Repo, ScanSummary } from './types.js';

export const WS_EVENT = {
  JOB_LOG: 'job:log',
  JOB_DONE: 'job:done',
  SCAN_DONE: 'scan:done',
  SCAN_REPO: 'scan:repo',
} as const;

export type WsEventType = (typeof WS_EVENT)[keyof typeof WS_EVENT];

export type WsJobLogPayload = { jobId: string; line: string };
export type WsJobDonePayload = {
  jobId: string;
  repoId: string;
  status: string;
  exitCode: number | null;
  diff: JobRecord['diff'];
};
export type WsScanDonePayload = ScanSummary;
export type WsScanRepoPayload = { repo: Repo };

export type WsEventPayload =
  | { type: typeof WS_EVENT.JOB_LOG; jobId: string; line: string }
  | {
      type: typeof WS_EVENT.JOB_DONE;
      jobId: string;
      repoId: string;
      status: string;
      exitCode: number | null;
      diff: JobRecord['diff'];
    }
  | {
      type: typeof WS_EVENT.SCAN_DONE;
      scanId: number;
      rootDir: string;
      total: number;
      okCount: number;
      failCount: number;
    }
  | { type: typeof WS_EVENT.SCAN_REPO; repo: Repo };
