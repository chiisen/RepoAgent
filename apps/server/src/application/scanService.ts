/**
 * ScanService — 掃描 orchestration（純業務；依賴注入）。
 */
import { existsSync } from 'node:fs';
import { basename, parse, resolve } from 'node:path';

import { RootDirNotFoundError } from '../domain/errors.js';
import { WS_EVENT } from '../domain/events.js';
import type {
  IConfigRepository,
  IEventBroadcaster,
  IGitInspector,
  IRepoExtrasCollector,
  IRepoLister,
  IRepoRepository,
  IScanProgressTracker,
  IScanRepository,
  RepoCallback,
} from '../domain/ports.js';
import type { Repo, ScanSummary } from '../domain/types.js';

const SCAN_CONCURRENCY = 6;

export class ScanService {
  constructor(
    private readonly repos: IRepoRepository,
    private readonly scans: IScanRepository,
    private readonly git: IGitInspector,
    private readonly lister: IRepoLister,
    private readonly extras: IRepoExtrasCollector,
    private readonly progress: IScanProgressTracker,
    private readonly config: IConfigRepository,
    private readonly broadcaster: IEventBroadcaster,
  ) {}

  async scanRoot(rawRoot: string, onRepo?: RepoCallback): Promise<ScanSummary> {
    const root = this.normalizeRootDir(rawRoot);
    if (!existsSync(root)) throw new RootDirNotFoundError(root);

    this.progress.reset();
    this.progress.markRunning(true);
    try {
      const startedAt = new Date().toISOString();
      const scanId = this.scans.create(root, startedAt);
      const snap = this.config.snapshot();

      const dirs = this.lister.list(root, snap.scanRecursive === true, snap.scanDepth);
      this.progress.setTotal(dirs.length);
      this.progress.setCurrent(dirs.length ? '' : '無 git 專案');

      this.repos.removeMissing(dirs.map((d) => d.path));

      let okCount = 0;
      let failCount = 0;
      const skip = new Set([...(snap.skipDirs ?? []), '.git'].map((s) => s.toLowerCase()));

      await mapPool(dirs, SCAN_CONCURRENCY, async (entry) => {
        const repoPath = entry.path;
        this.progress.setCurrent(entry.name);
        try {
          const info = await this.git.inspect(repoPath);
          const id = this.repos.ensureRepoId(repoPath);
          const extras = snap.extrasEnabled ? this.extras.collect(repoPath, skip, 2_000) : null;
          const row: Repo = {
            id,
            name: entry.name,
            path: repoPath,
            branch: info.branch,
            isDirty: info.isDirty,
            dirtyCount: info.dirtyCount,
            commitCount: info.commitCount,
            commitsToday: info.commitsToday,
            commitsWeek: info.commitsWeek,
            commitsMonth: info.commitsMonth,
            lastCommitHash: info.lastCommitHash,
            lastCommitTime: info.lastCommitTime,
            lastCommitMsg: info.lastCommitMsg,
            lastScannedAt: new Date().toISOString(),
            lastError: '',
            lastPullAt: '',
            lastPullMsg: '',
            remoteUrl: info.remoteUrl,
            ahead: info.ahead,
            behind: info.behind,
            language: extras?.language ?? '',
            sizeBytes: extras?.sizeBytes ?? 0,
            extrasTruncated: extras?.truncated ? 1 : 0,
          };
          this.repos.upsert(row);
          okCount++;
          onRepo?.(row);
          if (onRepo) this.broadcastScanRepo(row);
        } catch (e) {
          failCount++;
          const id = this.repos.ensureRepoId(repoPath);
          this.repos.markError(repoPath, entry.name, new Date().toISOString(), String(e).slice(0, 300), id);
          const updated = this.repos.findByPath(repoPath);
          if (updated) onRepo?.(updated);
        } finally {
          this.progress.bumpDone();
        }
      });

      const total = dirs.length;
      this.scans.finish(scanId, new Date().toISOString(), total, okCount, failCount);
      return { scanId, rootDir: root, total, okCount, failCount };
    } finally {
      this.progress.markRunning(false);
      this.progress.setCurrent('');
    }
  }

  /** 對單一 repo 重掃。 */
  async refreshRepo(repoPath: string, lastError = ''): Promise<void> {
    const name = basename(repoPath);
    try {
      const info = await this.git.inspect(repoPath);
      const id = this.repos.ensureRepoId(repoPath);
      const snap = this.config.snapshot();
      const skip = new Set([...(snap.skipDirs ?? []), '.git'].map((s) => s.toLowerCase()));
      const extras = snap.extrasEnabled ? this.extras.collect(repoPath, skip, 2_000) : null;
      this.repos.upsert({
        id,
        name,
        path: repoPath,
        branch: info.branch,
        isDirty: info.isDirty,
        dirtyCount: info.dirtyCount,
        commitCount: info.commitCount,
        commitsToday: info.commitsToday,
        commitsWeek: info.commitsWeek,
        commitsMonth: info.commitsMonth,
        lastCommitHash: info.lastCommitHash,
        lastCommitTime: info.lastCommitTime,
        lastCommitMsg: info.lastCommitMsg,
        lastScannedAt: new Date().toISOString(),
        lastError,
        lastPullAt: '',
        lastPullMsg: '',
        remoteUrl: info.remoteUrl,
        ahead: info.ahead,
        behind: info.behind,
        language: extras?.language ?? '',
        sizeBytes: extras?.sizeBytes ?? 0,
        extrasTruncated: extras?.truncated ? 1 : 0,
      });
    } catch (e) {
      const id = this.repos.ensureRepoId(repoPath);
      this.repos.markError(
        repoPath,
        name,
        new Date().toISOString(),
        lastError || String(e).slice(0, 300),
        id,
      );
    }
  }

  /** 對 scanner 暴露 windowStart（測試相容）。 */
  static windowStart(kind: 'today' | 'week' | 'month', now: Date = new Date()): string {
    const y = now.getFullYear();
    const m = now.getMonth();
    const d = now.getDate();
    if (kind === 'today') return new Date(y, m, d).toISOString();
    if (kind === 'week') return new Date(y, m, d - ((now.getDay() + 6) % 7)).toISOString();
    return new Date(y, m, 1).toISOString();
  }

  /** 對外暴露的命名函式（測試相容）。 */
  static windowStartNamed(kind: 'today' | 'week' | 'month', now?: Date): string {
    return ScanService.windowStart(kind, now);
  }

  private broadcastScanRepo(repo: Repo): void {
    this.broadcaster.broadcast({ type: WS_EVENT.SCAN_REPO, repo });
  }

  private normalizeRootDir(input: string): string {
    const trimmed = input.trim();
    if (!trimmed) return trimmed;
    const resolved = resolve(trimmed);
    const { root } = parse(resolved);
    if (resolved === root) return resolved;
    return resolved.replace(/[\\/]+$/, '');
  }
}

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  let i = 0;
  const worker = async (): Promise<void> => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) || 1 }, worker));
  return out;
}
