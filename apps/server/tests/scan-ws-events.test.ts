/**
 * 回歸測試（PR #18 review CRITICAL-1）：
 * ScanService.scanRoot 必須無條件推播 scan:repo（每個 repo 一筆）與 scan:done（結尾一筆），
 * 不得依賴呼叫端是否傳入 onRepo 回呼。
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ScanService } from '../src/application/scanService.js';
import type { WsEventPayload } from '../src/domain/events.js';
import { WS_EVENT } from '../src/domain/events.js';
import type { IConfigRepository, IRepoRepository, IScanRepository } from '../src/domain/ports.js';
import type { Repo, RepoInspection, RepoListResult, RepoQuery } from '../src/domain/types.js';

function fakeInspection(): RepoInspection {
  return {
    branch: 'main',
    isDirty: 0,
    dirtyCount: 0,
    commitCount: 3,
    commitsToday: 0,
    commitsWeek: 1,
    commitsMonth: 3,
    lastCommitHash: 'abc123',
    lastCommitTime: '2026-01-01T00:00:00.000Z',
    lastCommitMsg: 'init',
    remoteUrl: '',
    ahead: 0,
    behind: 0,
  };
}

/** 以 Map 為底的 in-memory IRepoRepository。 */
function makeRepoRepository(): IRepoRepository {
  const byPath = new Map<string, Repo>();
  let seq = 0;
  return {
    ensureRepoId(repoPath) {
      const found = byPath.get(repoPath);
      if (found) return found.id;
      const id = `id-${++seq}`;
      byPath.set(repoPath, { ...emptyRepo(), id, path: repoPath });
      return id;
    },
    upsert(repo) {
      byPath.set(repo.path, repo);
    },
    markError(repoPath, name, lastScannedAt, lastError, id) {
      byPath.set(repoPath, { ...emptyRepo(), id, name, path: repoPath, lastScannedAt, lastError });
    },
    findByPath(repoPath) {
      return byPath.get(repoPath);
    },
    findById(id) {
      return [...byPath.values()].find((r) => r.id === id);
    },
    readSnapshot(repoPath) {
      const r = byPath.get(repoPath);
      return {
        isDirty: r?.isDirty ?? 0,
        dirtyCount: r?.dirtyCount ?? 0,
        branch: r?.branch ?? '',
        lastCommitHash: r?.lastCommitHash ?? '',
      };
    },
    list(_query: RepoQuery): RepoListResult {
      return {
        repos: [...byPath.values()],
        total: byPath.size,
        stats: { total: byPath.size, dirty: 0 },
        commitRanking: [],
      };
    },
    removeMissing(keepPaths) {
      const keep = new Set(keepPaths);
      for (const p of [...byPath.keys()]) if (!keep.has(p)) byPath.delete(p);
    },
    recordLastPull(id, at, msg) {
      for (const [p, r] of byPath) if (r.id === id) byPath.set(p, { ...r, lastPullAt: at, lastPullMsg: msg });
    },
  };
}

function emptyRepo(): Repo {
  return {
    id: '',
    name: '',
    path: '',
    branch: '',
    isDirty: 0,
    dirtyCount: 0,
    commitCount: 0,
    commitsToday: 0,
    commitsWeek: 0,
    commitsMonth: 0,
    lastCommitHash: '',
    lastCommitTime: '',
    lastCommitMsg: '',
    lastScannedAt: '',
    lastError: '',
    lastPullAt: '',
    lastPullMsg: '',
    remoteUrl: '',
    ahead: null,
    behind: null,
    language: '',
    sizeBytes: 0,
    extrasTruncated: 0,
  };
}

function makeScanRepository(): IScanRepository {
  let next = 0;
  return {
    create() {
      return ++next;
    },
    finish() {
      /* noop */
    },
    lastRootDir() {
      return '';
    },
  };
}

let root = '';
const events: WsEventPayload[] = [];

function makeConfigRepository(): IConfigRepository {
  return {
    save() {},
    patch() {},
    snapshot: () => ({
      rootDir: root,
      piPath: 'pi',
      promptTemplates: [{ id: 'default', name: 'default', body: '{path} {branch}' }],
      activePromptId: 'default',
      promptTemplate: '{path} {branch}',
      timeout: 1800,
      piConcurrency: 2,
      scanRecursive: false,
      scanDepth: 1,
      skipDirs: [],
      extrasEnabled: true,
    }),
    setPromptTemplates: () => [],
    setSkipDirs: () => [],
    setRootDir: (raw: string) => raw,
    setPiPath() {},
    setTimeout() {},
    setPiConcurrency() {},
    setScanRecursive() {},
    setScanDepth() {},
    setActivePromptId() {},
    setPromptTemplateBody() {},
    setExtrasEnabled() {},
  };
}

function buildService(dirCount: number): ScanService {
  return new ScanService(
    makeRepoRepository(),
    makeScanRepository(),
    { inspect: async () => fakeInspection(), statusShort: async () => [], recentCommits: async () => [] },
    {
      list: () => Array.from({ length: dirCount }, (_v, i) => ({ path: join(root, `r${i}`), name: `r${i}` })),
    },
    { collect: () => ({ language: 'TS', sizeBytes: 10, truncated: false }) },
    {
      get: () => ({ running: false, total: 0, done: 0, current: '' }),
      reset() {},
      setTotal() {},
      setCurrent() {},
      bumpDone() {},
      markRunning() {},
    },
    makeConfigRepository(),
    {
      broadcast(event: WsEventPayload) {
        events.push(event);
      },
      attach() {},
      reset() {},
    },
  );
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'repoagent-scan-ws-'));
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('scanRoot 的 WS 事件', () => {
  it('不傳 onRepo 時仍推播 N 筆 scan:repo 與 1 筆 scan:done', async () => {
    events.length = 0;
    const summary = await buildService(3).scanRoot(root);

    const repoEvents = events.filter((e) => e.type === WS_EVENT.SCAN_REPO);
    const doneEvents = events.filter((e) => e.type === WS_EVENT.SCAN_DONE);

    expect(repoEvents).toHaveLength(3);
    expect(doneEvents).toHaveLength(1);
    expect(doneEvents[0]).toEqual({ type: WS_EVENT.SCAN_DONE, ...summary });
    expect(summary).toEqual({ scanId: 1, rootDir: root, total: 3, okCount: 3, failCount: 0 });
    for (const e of repoEvents) {
      expect(e).toMatchObject({ type: WS_EVENT.SCAN_REPO, repo: { name: expect.stringMatching(/^r\d$/) } });
    }
  });

  it('沒有 git 專案時只推播 1 筆 scan:done', async () => {
    events.length = 0;
    await buildService(0).scanRoot(root);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: WS_EVENT.SCAN_DONE, total: 0, okCount: 0, failCount: 0 });
  });

  it('inspect 失敗的 repo 不推播 scan:repo，但計入 failCount', async () => {
    events.length = 0;
    const service = buildService(2);
    // 讓第 2 個 repo inspect 失敗
    let seen = 0;
    const broken = service as unknown as { git: { inspect: (p: string) => Promise<RepoInspection> } };
    broken.git.inspect = async () => {
      seen++;
      if (seen === 2) throw new Error('boom');
      return fakeInspection();
    };

    const summary = await service.scanRoot(root);
    expect(summary.okCount).toBe(1);
    expect(summary.failCount).toBe(1);
    expect(events.filter((e) => e.type === WS_EVENT.SCAN_REPO)).toHaveLength(1);
    expect(events.filter((e) => e.type === WS_EVENT.SCAN_DONE)).toHaveLength(1);
  });
});
