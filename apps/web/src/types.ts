import type { GitDiff } from './format';

export type Repo = {
  id: string;
  name: string;
  path: string;
  branch?: string | null;
  isDirty?: boolean;
  dirtyCount?: number;
  commitCount?: number | null;
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
  language?: string | null;
  sizeBytes?: number | null;
  extrasTruncated?: number | boolean | null;
};

export type PromptTemplate = { id: string; name: string; body: string };

export type RepoStats = { total: number; dirty: number };

export type CommitRank = {
  id: string;
  name: string;
  commitCount: number;
  commitsToday: number;
  commitsWeek: number;
  commitsMonth: number;
};

export type CommitMetric = 'commitCount' | 'commitsToday' | 'commitsWeek' | 'commitsMonth';

export type Config = {
  rootDir: string;
  piPath: string;
  promptTemplate: string;
  promptTemplates?: PromptTemplate[];
  activePromptId?: string;
  timeout: number;
  piConcurrency: number;
  scanRecursive?: boolean;
  scanDepth?: number;
  skipDirs?: string[];
  extrasEnabled?: boolean;
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
