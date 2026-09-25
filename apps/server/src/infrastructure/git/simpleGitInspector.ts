/**
 * SimpleGitInspector — IGitInspector 實作（封裝 simple-git）。
 */
import { simpleGit } from 'simple-git';

import type { IGitInspector } from '../../domain/ports.js';
import { windowStartIso } from '../../domain/text.js';
import type { RepoInspection } from '../../domain/types.js';

const GIT_TIMEOUT_MS = 12_000;

function toCount(raw: string): number {
  const n = Number(raw.trim());
  return Number.isFinite(n) ? n : 0;
}

export class SimpleGitInspector implements IGitInspector {
  async inspect(repoPath: string): Promise<RepoInspection> {
    const git = simpleGit(repoPath, { timeout: { block: GIT_TIMEOUT_MS } });
    const now = new Date();
    const [branchRaw, porcelain, logOut, remoteUrl, countsRaw, countRaw, todayRaw, weekRaw, monthRaw] =
      await Promise.all([
        git.raw(['rev-parse', '--abbrev-ref', 'HEAD']).catch(() => ''),
        git.raw(['status', '--porcelain=v1']),
        git.raw(['log', '-1', '--format=%H%x09%aI%x09%s']).catch(() => ''),
        git.raw(['remote', 'get-url', 'origin']).catch(async () => {
          const names = (await git.raw(['remote']).catch(() => '')).trim().split(/\r?\n/).filter(Boolean);
          if (!names[0]) return '';
          return git.raw(['remote', 'get-url', names[0]]).catch(() => '');
        }),
        git.raw(['rev-list', '--left-right', '--count', '@{upstream}...HEAD']).catch(() => ''),
        git.raw(['rev-list', '--count', 'HEAD']).catch(() => ''),
        git.raw(['rev-list', '--count', `--since=${windowStartIso('today', now)}`, 'HEAD']).catch(() => ''),
        git.raw(['rev-list', '--count', `--since=${windowStartIso('week', now)}`, 'HEAD']).catch(() => ''),
        git.raw(['rev-list', '--count', `--since=${windowStartIso('month', now)}`, 'HEAD']).catch(() => ''),
      ]);
    const dirtyLines = porcelain.split(/\r?\n/).filter((l) => l.length > 0);
    const [hash = '', time = '', ...msg] = logOut.trim().split('\t');
    const parts = countsRaw.trim().split(/\s+/);
    const behind = parts.length >= 2 && parts[0] !== '' ? Number(parts[0]) : null;
    const ahead = parts.length >= 2 && parts[1] !== '' ? Number(parts[1]) : null;
    return {
      branch: branchRaw.trim(),
      isDirty: dirtyLines.length > 0 ? 1 : 0,
      dirtyCount: dirtyLines.length,
      commitCount: toCount(countRaw),
      commitsToday: toCount(todayRaw),
      commitsWeek: toCount(weekRaw),
      commitsMonth: toCount(monthRaw),
      lastCommitHash: hash,
      lastCommitTime: time,
      lastCommitMsg: msg.join('\t').trim(),
      remoteUrl: String(remoteUrl).trim(),
      ahead: ahead !== null && Number.isFinite(ahead) ? ahead : null,
      behind: behind !== null && Number.isFinite(behind) ? behind : null,
    };
  }

  async statusShort(repoPath: string, limit: number): Promise<string[]> {
    const git = simpleGit(repoPath, { timeout: { block: GIT_TIMEOUT_MS } });
    const out = await git.raw(['status', '--short']);
    return out
      .split(/\r?\n/)
      .filter((l) => l.length > 0)
      .slice(0, limit);
  }

  async recentCommits(
    repoPath: string,
    limit: number,
  ): Promise<{ hash: string; date: string; message: string }[]> {
    const git = simpleGit(repoPath, { timeout: { block: GIT_TIMEOUT_MS } });
    const out = await git.raw(['log', `-${limit}`, '--format=%H|%ad|%s', '--date=iso']);
    return out
      .split(/\r?\n/)
      .filter((l) => l.length > 0)
      .map((l) => {
        const [hash = '', date = '', ...msg] = l.split('|');
        return { hash, date, message: msg.join('|') };
      });
  }
}
