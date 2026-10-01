/**
 * 重疊掃描不得互刪 repos；根路徑是檔案時在 removeMissing 之前失敗（issue #31）。
 */
import express from 'express';
import type { Server } from 'node:http';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { ScanService } from '../src/application/scanService.js';
import { ScanProgressTracker } from '../src/application/scanProgressTracker.js';
import { ScanInProgressError } from '../src/domain/errors.js';
import type { IConfigRepository, IEventBroadcaster, IGitInspector } from '../src/domain/ports.js';
import type { RepoInspection } from '../src/domain/types.js';
import { DirectoryRepoLister } from '../src/infrastructure/fs/directoryRepoLister.js';
import { openConnection } from '../src/infrastructure/sqlite/connection.js';
import { SqliteRepoRepository } from '../src/infrastructure/sqlite/sqliteRepoRepository.js';
import { SqliteScanRepository } from '../src/infrastructure/sqlite/sqliteScanRepository.js';
import { createScanRouter } from '../src/routes/_internal/scan.js';

function inspection(): RepoInspection {
  return {
    branch: 'main',
    isDirty: 0,
    dirtyCount: 0,
    commitCount: 1,
    commitsToday: 0,
    commitsWeek: 0,
    commitsMonth: 1,
    lastCommitHash: 'abc',
    lastCommitTime: '2026-01-01T00:00:00.000Z',
    lastCommitMsg: 'init',
    remoteUrl: '',
    ahead: 0,
    behind: 0,
  };
}

function configRepo(root: string): IConfigRepository {
  const snap = {
    rootDir: root,
    piPath: 'pi',
    promptTemplate: 'x',
    promptTemplates: [{ id: 'default', name: '預設', body: 'x' }],
    activePromptId: 'default',
    timeout: 1800,
    piConcurrency: 2,
    scanRecursive: false,
    scanDepth: 1,
    skipDirs: [] as string[],
    extrasEnabled: false,
  };
  return {
    save() {},
    patch() {},
    snapshot: () => snap,
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

const broadcaster: IEventBroadcaster = {
  broadcast() {},
  attach() {},
  reset() {},
};

describe('scanRoot 互斥與目錄檢查', () => {
  const dirs: string[] = [];
  const servers: Server[] = [];

  afterEach(async () => {
    await Promise.all(
      servers.splice(0).map(
        (server) =>
          new Promise<void>((resolve, reject) => {
            server.close((err) => (err ? reject(err) : resolve()));
          }),
      ),
    );
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function harness(hangInspect: boolean) {
    const root = mkdtempSync(join(tmpdir(), 'repoagent-scan-'));
    dirs.push(root);
    const repoPath = join(root, 'demo');
    mkdirSync(repoPath);
    writeFileSync(join(repoPath, '.git'), 'gitdir: fake\n');
    const db = openConnection(':memory:').raw();
    const repoRepo = new SqliteRepoRepository(db);
    let release: () => void = () => {};
    const git: IGitInspector = {
      inspect: () =>
        hangInspect
          ? new Promise((resolve) => {
              release = () => resolve(inspection());
            })
          : Promise.resolve(inspection()),
      statusShort: async () => [],
      recentCommits: async () => [],
    };
    const progress = new ScanProgressTracker();
    const service = new ScanService(
      repoRepo,
      new SqliteScanRepository(db),
      git,
      new DirectoryRepoLister(() => new Set(['.git'])),
      { collect: () => ({ language: '', sizeBytes: 0, truncated: false }) },
      progress,
      configRepo(root),
      broadcaster,
    );
    const count = () => (db.prepare('SELECT COUNT(*) AS n FROM repos').get() as { n: number }).n;
    return { root, repoPath, repoRepo, service, progress, release: () => release(), count };
  }

  it('進行中的第二次 scanRoot 被拒絕，且不會刪掉這次掃描的 repos', async () => {
    const h = harness(true);
    h.repoRepo.ensureRepoId(h.repoPath);
    expect(h.count()).toBe(1);

    const first = h.service.scanRoot(h.root);
    await new Promise((resolve) => setImmediate(resolve));
    await expect(h.service.scanRoot(h.root)).rejects.toBeInstanceOf(ScanInProgressError);
    expect(h.count()).toBe(1);

    h.release();
    await first;
    expect(h.count()).toBe(1);
  });

  it('POST /api/scan 在掃描進行中回 409', async () => {
    const h = harness(true);
    const app = express();
    app.use(express.json());
    app.use('/api', createScanRouter(h.service, h.progress));
    const server = app.listen(0, '127.0.0.1');
    servers.push(server);
    await new Promise<void>((resolve) => server.once('listening', () => resolve()));
    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('no port');

    const first = h.service.scanRoot(h.root);
    await new Promise((resolve) => setImmediate(resolve));
    const second = await fetch(`http://127.0.0.1:${addr.port}/api/scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rootDir: h.root }),
    });
    expect(second.status).toBe(409);
    h.release();
    const summary = await first;
    expect(summary.okCount).toBe(1);
  });

  it('根路徑是檔案時失敗，且不會清掉 repos', async () => {
    const h = harness(false);
    const kept = join(h.root, 'kept');
    mkdirSync(kept);
    h.repoRepo.ensureRepoId(kept);
    const fileRoot = join(h.root, 'not-a-dir.txt');
    writeFileSync(fileRoot, 'x');
    expect(h.count()).toBe(1);
    await expect(h.service.scanRoot(fileRoot)).rejects.toThrow(/rootDir not found/);
    expect(h.count()).toBe(1);
  });
});
