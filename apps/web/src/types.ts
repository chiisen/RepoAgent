import type { GitDiff } from './format';

export type Repo = {
  id: string;
  name: string;
  path: string;
  branch?: string | null;
  isDirty?: boolean;
  dirtyCount?: number;
  lastCommitHash?: string | null;
  lastCommitTime?: string | null;
  lastCommitMsg?: string | null;
  lastScannedAt?: string | null;
  lastError?: string | null;
  lastPullAt?: string | null;
  lastPullMsg?: string | null;
  remoteUrl?: string | null;
  ahead?: number | null;
  behind?: number | null;
};

export type Config = {
  rootDir: string;
  piPath: string;
  promptTemplate: string;
  timeout: number;
};

export type Job = {
  id: string;
  status: string;
  exitCode: number | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  diff?: GitDiff | null;
};

export type JobDetail = {
  job: Job;
  logTail: string[];
  heartbeat?: { ageSec: number; size: number } | null;
  timeoutSec?: number;
};

export type RepoDetail = {
  repo: Repo;
  statusShort: string[];
  recentCommits: { hash: string; date: string; message: string }[];
};

export type ScanProgress = { done?: number; total?: number; current?: string };
