/**
 * RepoService — 對外提供 list / detail / optimize / pull。
 */
import { randomUUID } from 'node:crypto';

import {
  InvalidPromptError,
  PiAlreadyRunningError,
  PiConcurrencyLimitError,
  RepoNotFoundError,
} from '../domain/errors.js';
import type {
  IConfigRepository,
  IGitInspector,
  IJobRegistry,
  IPullExecutor,
  IRepoRepository,
} from '../domain/ports.js';
import type {
  JobRecord,
  JobStatus,
  PullResult,
  Repo,
  RepoDetailExtra,
  RepoListResult,
  RepoQuery,
} from '../domain/types.js';
import { resolveOptimizePrompt } from './promptResolverShim.js';
import { ScanService } from './scanService.js';

export type OptimizeRequest = { prompt?: unknown; promptId?: unknown };
export type OptimizeResult = { job: JobRecord };

export class RepoService {
  constructor(
    private readonly repos: IRepoRepository,
    private readonly config: IConfigRepository,
    private readonly jobs: IJobRegistry,
    private readonly git: IGitInspector,
    private readonly pull: IPullExecutor,
    private readonly scanner: ScanService,
    private readonly startJob: (job: JobRecord) => Promise<void>,
  ) {}

  list(query: RepoQuery): RepoListResult {
    return this.repos.list(query);
  }

  async getDetail(id: string): Promise<{ repo: Repo; extra: RepoDetailExtra }> {
    const repo = this.repos.findById(id);
    if (!repo) throw new RepoNotFoundError(id);
    const [statusShort, recentCommits] = await Promise.all([
      this.git.statusShort(repo.path, 50),
      this.git.recentCommits(repo.path, 5),
    ]);
    return { repo, extra: { statusShort, recentCommits } };
  }

  optimize(id: string, body: OptimizeRequest): OptimizeResult {
    const repo = this.repos.findById(id);
    if (!repo) throw new RepoNotFoundError(id);
    const same = this.jobs.activeForRepo(repo.path);
    if (same) throw new PiAlreadyRunningError(same.id);
    const limit = this.piConcurrency();
    if (this.jobs.listActive().length >= limit) throw new PiConcurrencyLimitError(limit);

    let prompt: string;
    try {
      const snap = this.config.snapshot();
      prompt = resolveOptimizePrompt(snap, repo.path, repo.branch || '', body).prompt;
    } catch (e) {
      throw new InvalidPromptError(String((e as Error).message || e));
    }

    const job = this.jobs.create(repo.path, prompt);
    void this.startJob(job);
    return { job };
  }

  async pullRepo(id: string): Promise<{ result: PullResult; repo: Repo }> {
    const repo = this.repos.findById(id);
    if (!repo) throw new RepoNotFoundError(id);
    const result = await this.pull.pullFastForward(repo.path, randomUUID());
    await this.scanner.refreshRepo(repo.path, result.ok ? '' : result.message);
    const pullMsg = this.lastOutputLine(result.message || result.output);
    this.repos.recordLastPull(id, new Date().toISOString(), pullMsg);
    const updated = this.repos.findById(id);
    if (!updated) throw new RepoNotFoundError(id);
    return { result, repo: updated };
  }

  /** 對外：取得目前 job timeout（秒）。 */
  jobTimeoutSec(): number {
    return this.jobTimeoutMs() / 1000;
  }

  /** 對外：取得目前 job timeout（ms）。 */
  jobTimeoutMs(): number {
    const s = Number(this.config.snapshot().timeout);
    if (!Number.isFinite(s) || s < 60 || s > 7200) return 30 * 60 * 1000;
    return Math.floor(s) * 1000;
  }

  private piConcurrency(): number {
    const n = Number(this.config.snapshot().piConcurrency);
    if (!Number.isInteger(n) || n < 1 || n > 4) return 2;
    return n;
  }

  private lastOutputLine(text: string): string {
    const lines = text
      .replace(/\r/g, '')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    return (lines[lines.length - 1] || text.trim() || '').slice(0, 200);
  }
}

/** 對外公開（測試相容）：直接給 active jobs 列表與 pi concurrency。 */
// biome-ignore lint/complexity/noStaticOnlyClass: 測試相容 API 介面（舊 optimizer.test.ts 使用）
export class RepoQueryHelpers {
  static listActiveJobs(jobs: IJobRegistry): JobRecord[] {
    return jobs.listActive();
  }
  static piConcurrency(config: IConfigRepository): number {
    const n = Number(config.snapshot().piConcurrency);
    if (!Number.isInteger(n) || n < 1 || n > 4) return 2;
    return n;
  }
  static jobTimeoutMs(config: IConfigRepository): number {
    const s = Number(config.snapshot().timeout);
    if (!Number.isFinite(s) || s < 60 || s > 7200) return 30 * 60 * 1000;
    return Math.floor(s) * 1000;
  }
}

// ── 測試相容 export（給舊 optimizer.test.ts import JobStatus） ──
export type { JobStatus };
