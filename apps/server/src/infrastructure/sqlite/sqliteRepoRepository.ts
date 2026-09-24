/**
 * SqliteRepoRepository — IRepoRepository 實作。
 */
import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import type { IRepoRepository } from '../../domain/ports.js';
import type {
  CommitRanking,
  JobDiffState,
  Repo,
  RepoDetailExtra,
  RepoListResult,
  RepoQuery,
  RepoStats,
} from '../../domain/types.js';

export class SqliteRepoRepository implements IRepoRepository {
  constructor(private readonly db: DatabaseSync) {}

  private stmt(sql: string) {
    return this.db.prepare(sql);
  }

  ensureRepoId(repoPath: string): string {
    const row = this.stmt('SELECT id FROM repos WHERE path=?').get(repoPath) as { id: string } | undefined;
    if (row) return row.id;
    const id = randomUUID();
    this.stmt(
      'INSERT INTO repos(id, name, path, branch, isDirty, dirtyCount, lastCommitHash, lastCommitTime, lastCommitMsg, lastScannedAt, lastError) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
    ).run(id, '', repoPath, '', 0, 0, '', '', '', '', '');
    return id;
  }

  upsert(repo: Repo): void {
    const has = this.stmt('SELECT 1 FROM repos WHERE path=?').get(repo.path);
    if (has) {
      this.stmt(
        `UPDATE repos SET name=?, branch=?, isDirty=?, dirtyCount=?, commitCount=?, commitsToday=?, commitsWeek=?, commitsMonth=?, lastCommitHash=?, lastCommitTime=?, lastCommitMsg=?, lastScannedAt=?, lastError=?, remoteUrl=?, ahead=?, behind=?, language=?, sizeBytes=?, extrasTruncated=? WHERE path=?`,
      ).run(
        repo.name,
        repo.branch,
        repo.isDirty,
        repo.dirtyCount,
        repo.commitCount,
        repo.commitsToday,
        repo.commitsWeek,
        repo.commitsMonth,
        repo.lastCommitHash,
        repo.lastCommitTime,
        repo.lastCommitMsg,
        repo.lastScannedAt,
        repo.lastError,
        repo.remoteUrl,
        repo.ahead,
        repo.behind,
        repo.language || '',
        repo.sizeBytes || 0,
        repo.extrasTruncated || 0,
        repo.path,
      );
    } else {
      this.stmt(
        `INSERT INTO repos(id, name, path, branch, isDirty, dirtyCount, commitCount, commitsToday, commitsWeek, commitsMonth, lastCommitHash, lastCommitTime, lastCommitMsg, lastScannedAt, lastError, remoteUrl, ahead, behind, language, sizeBytes, extrasTruncated) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).run(
        repo.id,
        repo.name,
        repo.path,
        repo.branch,
        repo.isDirty,
        repo.dirtyCount,
        repo.commitCount,
        repo.commitsToday,
        repo.commitsWeek,
        repo.commitsMonth,
        repo.lastCommitHash,
        repo.lastCommitTime,
        repo.lastCommitMsg,
        repo.lastScannedAt,
        repo.lastError,
        repo.remoteUrl,
        repo.ahead,
        repo.behind,
        repo.language || '',
        repo.sizeBytes || 0,
        repo.extrasTruncated || 0,
      );
    }
  }

  markError(_repoPath: string, name: string, lastScannedAt: string, lastError: string, id: string): void {
    this.stmt('UPDATE repos SET name=?, lastScannedAt=?, lastError=? WHERE id=?').run(
      name,
      lastScannedAt,
      lastError,
      id,
    );
  }

  findByPath(repoPath: string): Repo | undefined {
    return this.stmt('SELECT * FROM repos WHERE path=?').get(repoPath) as Repo | undefined;
  }

  findById(id: string): Repo | undefined {
    return this.stmt('SELECT * FROM repos WHERE id=?').get(id) as Repo | undefined;
  }

  readSnapshot(repoPath: string): JobDiffState {
    const empty: JobDiffState = { isDirty: 0, dirtyCount: 0, branch: '', lastCommitHash: '' };
    try {
      const row = this.stmt('SELECT isDirty, dirtyCount, branch, lastCommitHash FROM repos WHERE path=?').get(
        repoPath,
      ) as JobDiffState | undefined;
      if (!row) return empty;
      return {
        isDirty: row.isDirty,
        dirtyCount: row.dirtyCount,
        branch: row.branch,
        lastCommitHash: row.lastCommitHash,
      };
    } catch {
      return empty;
    }
  }

  list(query: RepoQuery): RepoListResult {
    const { q, filter, sort } = query;
    let sql = 'SELECT * FROM repos';
    const params: (string | number)[] = [];
    const conditions: string[] = [];

    if (q) {
      conditions.push('name LIKE ?');
      params.push(`%${q}%`);
    }
    if (filter === 'dirty') {
      conditions.push('isDirty = 1');
    } else if (filter === 'clean') {
      conditions.push('isDirty = 0');
    }
    if (conditions.length) sql += ` WHERE ${conditions.join(' AND ')}`;
    if (sort === 'lastCommitTime') {
      sql += ' ORDER BY lastCommitTime DESC';
    } else {
      sql += ' ORDER BY name ASC';
    }

    const repos = this.stmt(sql).all(...params) as unknown[];
    const stats = this.stmt(
      'SELECT COUNT(*) AS total, COALESCE(SUM(isDirty), 0) AS dirty FROM repos',
    ).get() as RepoStats;
    const commitRanking = this.stmt(
      'SELECT id, name, commitCount, commitsToday, commitsWeek, commitsMonth FROM repos ORDER BY commitCount DESC, name ASC',
    ).all() as CommitRanking[];

    return { repos: repos as RepoListResult['repos'], total: repos.length, stats, commitRanking };
  }

  async getDetailAsync(
    repoPath: string,
    _limit: number,
    _extraLoader: (path: string) => Promise<RepoDetailExtra>,
  ): Promise<Repo | null> {
    const repo = this.findByPath(repoPath);
    if (!repo) return null;
    return repo;
  }

  getDetail(id: string): { repo: Repo; extra: RepoDetailExtra } {
    const found = this.stmt('SELECT * FROM repos WHERE id=?').get(id) as Repo | undefined;
    if (!found) {
      throw new Error(`repo not found: ${id}`);
    }
    return {
      repo: found,
      extra: { statusShort: [], recentCommits: [] },
    };
  }

  removeMissing(keepPaths: string[]): void {
    if (keepPaths.length === 0) {
      this.db.exec('DELETE FROM repos');
      return;
    }
    const ph = keepPaths.map(() => '?').join(',');
    this.stmt(`DELETE FROM repos WHERE path NOT IN (${ph})`).run(...(keepPaths as never[]));
  }

  recordLastPull(id: string, at: string, msg: string): void {
    this.stmt('UPDATE repos SET lastPullAt=?, lastPullMsg=? WHERE id=?').run(at, msg, id);
  }

  countAll(): RepoStats {
    return this.stmt(
      'SELECT COUNT(*) AS total, COALESCE(SUM(isDirty), 0) AS dirty FROM repos',
    ).get() as RepoStats;
  }

  ranking(): CommitRanking[] {
    return this.stmt(
      'SELECT id, name, commitCount, commitsToday, commitsWeek, commitsMonth FROM repos ORDER BY commitCount DESC, name ASC',
    ).all() as CommitRanking[];
  }
}
