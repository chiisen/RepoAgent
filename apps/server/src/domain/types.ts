/**
 * Domain types — 純業務型別，不依賴任何外部套件。
 */

/** Repo 對應 DB 一列；所有欄位型別以 SQLite 表為準。 */
export type Repo = {
  id: string;
  name: string;
  path: string;
  branch: string;
  isDirty: number;
  dirtyCount: number;
  commitCount: number;
  commitsToday: number;
  commitsWeek: number;
  commitsMonth: number;
  lastCommitHash: string;
  lastCommitTime: string;
  lastCommitMsg: string;
  lastScannedAt: string;
  lastError: string;
  lastPullAt: string;
  lastPullMsg: string;
  remoteUrl: string;
  ahead: number | null;
  behind: number | null;
  language: string;
  sizeBytes: number;
  extrasTruncated: number;
};

/** 單次掃描紀錄。 */
export type Scan = {
  id: number;
  rootDir: string;
  startedAt: string;
  finishedAt: string;
  total: number;
  okCount: number;
  failCount: number;
};

/** 排程任務（向後相容舊 db.ts 匯出）。 */
export type Job = {
  id: string;
  repoId: string;
  prompt: string;
  status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
  logPath: string;
  exitCode: number | null;
  startedAt: string;
  finishedAt: string | null;
};

/** 優化任務狀態。 */
export type JobStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

export type JobDiffState = {
  isDirty: number;
  dirtyCount: number;
  branch: string;
  lastCommitHash: string;
};

export type JobDiff = {
  before: JobDiffState;
  after: JobDiffState;
};

export type JobRecord = {
  id: string;
  repoId: string;
  prompt: string;
  status: JobStatus;
  logPath: string;
  exitCode: number | null;
  startedAt: string;
  finishedAt: string | null;
  diff: JobDiff | null;
};

/** Prompt 樣板。 */
export type PromptTemplate = { id: string; name: string; body: string };

/** 掃描結果摘要。 */
export type ScanSummary = {
  scanId: number;
  rootDir: string;
  total: number;
  okCount: number;
  failCount: number;
};

/** 掃描進行中狀態（用於前端 progress 輪詢）。 */
export type ScanProgress = {
  running: boolean;
  total: number;
  done: number;
  current: string;
};

/** Repo 額外資訊（語言 / 大小 / 是否截斷）。 */
export type RepoExtras = {
  language: string;
  sizeBytes: number;
  truncated: boolean;
};

/** Repo git 細節（單次 inspect 的結果）。 */
export type RepoInspection = {
  branch: string;
  isDirty: number;
  dirtyCount: number;
  commitCount: number;
  commitsToday: number;
  commitsWeek: number;
  commitsMonth: number;
  lastCommitHash: string;
  lastCommitTime: string;
  lastCommitMsg: string;
  remoteUrl: string;
  ahead: number | null;
  behind: number | null;
};

/** Pull 結果。 */
export type PullCode = 'ok' | 'dirty' | 'no_upstream' | 'git' | 'timeout';

export type PullResult = {
  ok: boolean;
  code: PullCode;
  message: string;
  output: string;
  logPath: string;
};

/** Repo 列表查詢條件。 */
export type RepoQuery = {
  q: string;
  filter: 'all' | 'dirty' | 'clean';
  sort: 'name' | 'lastCommitTime';
};

/** Repo 列表的回傳項目（扁平化為前端需要的形狀）。 */
export type RepoListItem = Repo & Record<string, unknown>;

export type RepoStats = { total: number; dirty: number };

export type CommitRanking = {
  id: string;
  name: string;
  commitCount: number;
  commitsToday: number;
  commitsWeek: number;
  commitsMonth: number;
};

export type RepoListResult = {
  repos: RepoListItem[];
  total: number;
  stats: RepoStats;
  commitRanking: CommitRanking[];
};

export type RepoDetailExtra = {
  statusShort: string[];
  recentCommits: { hash: string; date: string; message: string }[];
};

/** Pi 心跳資訊。 */
export type PiHeartbeat = {
  file: string;
  size: number;
  mtime: string;
  ageSec: number;
};

// 重新匯出 domain/config 中的型別以維持單一入口
export type { ConfigStore } from './config.js';
