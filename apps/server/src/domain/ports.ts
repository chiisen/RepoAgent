/**
 * Domain — Ports（介面）。Domain 層只依賴這些介面，不碰任何技術細節。
 * Adapter 實作位於 infrastructure/；Service 透過建構子注入這些介面。
 */
import type { ChildProcess } from 'node:child_process';

import type { WsEventPayload } from './events.js';
import type {
  CommitRanking,
  ConfigStore,
  JobDiffState,
  JobRecord,
  PiHeartbeat,
  PromptTemplate,
  PullResult,
  Repo,
  RepoDetailExtra,
  RepoExtras,
  RepoInspection,
  RepoListResult,
  RepoQuery,
  ScanProgress,
  ScanSummary,
} from './types.js';

// ─── Repository ports ────────────────────────────────────────────────────

/** Repo 資料倉儲。 */
export interface IRepoRepository {
  ensureRepoId(repoPath: string): string;
  upsert(repo: Repo): void;
  markError(repoPath: string, name: string, lastScannedAt: string, lastError: string, id: string): void;
  findByPath(repoPath: string): Repo | undefined;
  findById(id: string): Repo | undefined;
  readSnapshot(repoPath: string): JobDiffState;
  list(query: RepoQuery): RepoListResult;
  getDetail(id: string): { repo: Repo; extra: RepoDetailExtra };
  removeMissing(keepPaths: string[]): void;
  recordLastPull(id: string, at: string, msg: string): void;
  countAll(): { total: number; dirty: number };
  ranking(): CommitRanking[];
}

/** 掃描紀錄倉儲。 */
export interface IScanRepository {
  create(rootDir: string, startedAt: string): number;
  finish(scanId: number, finishedAt: string, total: number, okCount: number, failCount: number): void;
  lastRootDir(): string;
}

/** 設定倉儲（含檔案持久化）。 */
export interface IConfigRepository {
  load(): ConfigStore;
  save(): void;
  patch(input: Partial<ConfigStore> & Record<string, unknown>): void;
  /** 回傳當前 in-memory 設定。 */
  snapshot(): ConfigStore;
  /** 驗證並寫入；丟出 InvalidPromptError / InvalidSkipDirsError。 */
  setPromptTemplates(raw: unknown): PromptTemplate[];
  setSkipDirs(raw: unknown): string[];
  setRootDir(raw: string): string;
  setPiPath(raw: string): void;
  setTimeout(raw: unknown): void;
  setPiConcurrency(raw: unknown): void;
  setScanRecursive(raw: unknown): void;
  setScanDepth(raw: unknown): void;
  setActivePromptId(raw: unknown): void;
  setPromptTemplateBody(raw: unknown): void;
  setExtrasEnabled(raw: unknown): void;
}

// ─── Infrastructure ports ────────────────────────────────────────────────

/** Git inspect（status / log / rev-list / remote）。 */
export interface IGitInspector {
  inspect(repoPath: string): Promise<RepoInspection>;
  statusShort(repoPath: string, limit: number): Promise<string[]>;
  recentCommits(repoPath: string, limit: number): Promise<{ hash: string; date: string; message: string }[]>;
}

/** git pull --ff-only 執行器。 */
export interface IPullExecutor {
  pullFastForward(repoPath: string, jobId: string): Promise<PullResult>;
}

/** 列出 rootDir 下一層（含遞迴）的 git repo 路徑。 */
export interface IRepoLister {
  list(rootDir: string, recursive: boolean, maxDepth: number): { path: string; name: string }[];
}

/** Repo extras（語言 / 大小 / 是否截斷）。 */
export interface IRepoExtrasCollector {
  collect(repoPath: string, skipNames: Set<string>, timeoutMs: number): RepoExtras;
}

/** Child process 執行器（spawn / taskkill）。 */
export interface IProcessRunner {
  spawn(
    command: string,
    args: string[],
    opts: { cwd: string; shell: boolean; windowsHide: boolean; env: Record<string, string> },
  ): ChildProcess;
  killTree(child: ChildProcess): void;
}

/** WS 事件廣播器。 */
export interface IEventBroadcaster {
  broadcast(event: WsEventPayload): void;
  /** 綁定底層 ws.Server 實例（測試可注入 mock）。 */
  attach(server: { clients?: Iterable<unknown> } | null): void;
  /** 重新初始化內部狀態（測試用）。 */
  reset(): void;
}

/** 檔案 log 寫入與輪轉。 */
export interface IFileLogStore {
  writeJobLog(logPath: string, line: string): void;
  appendJobLog(logPath: string, line: string): void;
  ensureLogFile(logPath: string): void;
  prune(dir: string, keep: number): { kept: number; deleted: number };
}

/** Pi session heartbeat probe。 */
export interface IHeartbeatProbe {
  getHeartbeat(sinceIso: string): PiHeartbeat | null;
}

/** Pi 工作階段目錄位置。 */
export interface ISessionRootProvider {
  root(): string;
}

// ─── Application ports（純應用層抽象）────────────────────────────────

/** 掃描進度狀態。 */
export interface IScanProgressTracker {
  get(): ScanProgress;
  reset(): void;
  setTotal(total: number): void;
  setCurrent(current: string): void;
  bumpDone(): void;
  markRunning(running: boolean): void;
}

/** Job registry（in-memory job tracker）。 */
export interface IJobRegistry {
  create(repoId: string, prompt: string): JobRecord;
  setStatus(id: string, status: JobRecord['status'], patch?: Partial<JobRecord>): void;
  get(id: string): JobRecord | undefined;
  delete(id: string): void;
  listActive(): JobRecord[];
  activeForRepo(repoPath: string): JobRecord | undefined;
  setChild(id: string, child: ChildProcess): void;
  getChild(id: string): ChildProcess | undefined;
  removeChild(id: string): void;
  setTimeoutHandle(id: string, handle: ReturnType<typeof setTimeout>): void;
  clearTimeoutHandle(id: string): void;
  setPulseHandle(id: string, handle: ReturnType<typeof setInterval>): void;
  clearPulseHandle(id: string): void;
  clearAll(): void;
}

/** 排程包裝：用於把耗時任務排到背景跑（commit stats backfill）。 */
export interface IBackgroundRunner {
  run(task: () => Promise<void>): void;
}

/** 提供完整掃描結果（含摘要 + 每個 repo 的回呼）。 */
export interface IScanSummaryReporter {
  report(summary: ScanSummary): void;
}

/** Scan 用來通知 caller「每個 repo 完成」。 */
export type RepoCallback = (repo: Repo) => void;

// ─── 容器組裝時用：DB port（因為 connection 比較特殊，留為小介面）────────

export interface IDatabaseConnection {
  /** 取得 raw DatabaseSync，供測試或極少見情境使用。 */
  raw(): unknown;
  close(): void;
}
