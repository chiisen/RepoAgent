/**
 * Composition Root — 唯一允許 `new` 具體實例的地方。
 * 把所有介面與實作組裝起來，提供具體服務給上層（routes / shim）使用。
 */
import type { DatabaseSync } from 'node:sqlite';
import { ConfigService } from '../application/configService.js';
import { HeartbeatService } from '../application/heartbeatService.js';
import { JobRegistry } from '../application/jobRegistry.js';
import { JobService } from '../application/jobService.js';
import { RepoService } from '../application/repoService.js';
import { ScanProgressTracker } from '../application/scanProgressTracker.js';
import { ScanService } from '../application/scanService.js';
import type { IConfigRepository } from '../domain/ports.js';
import { FileConfigRepository } from '../infrastructure/fs/configRepository.js';
import { DirectoryRepoLister } from '../infrastructure/fs/directoryRepoLister.js';
import { FsExtrasCollector } from '../infrastructure/fs/extrasCollector.js';
import { FsFileLogStore } from '../infrastructure/fs/fileLogStore.js';
import {
  DefaultSessionRootProvider,
  PiSessionHeartbeatProbe,
} from '../infrastructure/fs/piSessionHeartbeatProbe.js';
import { ChildProcessPullExecutor } from '../infrastructure/git/childProcessPullExecutor.js';
import { SimpleGitInspector } from '../infrastructure/git/simpleGitInspector.js';
import { NodeProcessRunner } from '../infrastructure/process/nodeProcessRunner.js';
import { openConnection } from '../infrastructure/sqlite/connection.js';
import { SqliteRepoRepository } from '../infrastructure/sqlite/sqliteRepoRepository.js';
import { SqliteScanRepository } from '../infrastructure/sqlite/sqliteScanRepository.js';
import { WebsocketBroadcaster } from '../infrastructure/ws/websocketBroadcaster.js';
import { sharedContainer } from './_sharedContainer.js';

/** 預設的 skip 目錄集合（含 .git + 設定）。 */
function makeSkipNames(config: IConfigRepository): () => Set<string> {
  const ALWAYS_SKIP = new Set(['.git']);
  return () => {
    const extra = Array.isArray(config.snapshot().skipDirs) ? config.snapshot().skipDirs : [];
    return new Set([...ALWAYS_SKIP, ...extra.map((s) => String(s).toLowerCase())]);
  };
}

/** Application 啟動時的環境變數（保留舊行為：避免等 git 憑證）。 */
function applyGitEnv(): void {
  for (const [k, v] of Object.entries({
    GIT_TERMINAL_PROMPT: '0',
    GCM_INTERACTIVE: 'never',
    GIT_OPTIONAL_LOCKS: '0',
  } as const)) {
    process.env[k] ??= v;
  }
}

export type Container = ReturnType<typeof createContainer>;

export function createContainer(opts?: { dbPath?: string; configPath?: string }) {
  applyGitEnv();
  return buildContainerInternal({
    dbPath: opts?.dbPath ?? ':memory:',
    configPath: opts?.configPath,
  });
}

/** 為已存在的 db 構造服務（測試場景：測試持有自己的 db，需要同一組 singleton services）。 */
export function createServicesForDb(db: DatabaseSync, _opts?: { configPath?: string }) {
  applyGitEnv();
  // 共用 composition/_sharedContainer 的 singleton（測試與 shim 共用同一個 configRepo）
  const shared = sharedContainer();
  const repoRepo = new SqliteRepoRepository(db);
  const scanRepo = new SqliteScanRepository(db);
  const scanService = new ScanService(
    repoRepo,
    scanRepo,
    shared.gitInspector,
    shared.repoLister,
    shared.extrasCollector,
    shared.progress,
    shared.configRepo,
    shared.broadcaster,
  );
  const jobService = new JobService(
    repoRepo,
    shared.jobRegistry,
    shared.configRepo,
    shared.broadcaster,
    shared.logStore,
    shared.heartbeatProbe,
    shared.processRunner,
    async (repoPath, lastError) => scanService.refreshRepo(repoPath, lastError),
  );
  const repoService = new RepoService(
    repoRepo,
    shared.configRepo,
    shared.jobRegistry,
    shared.gitInspector,
    shared.pullExecutor,
    scanService,
    (job) => jobService.startJob(job),
  );
  return { ...shared, db, repoRepo, scanRepo, scanService, jobService, repoService };
}

/** 建立完整 container：DB → adapters → repositories → services。 */
function buildContainerInternal(opts: { dbPath: string; configPath?: string }) {
  // 1. DB
  const connection = openConnection(opts.dbPath);
  const db = connection.raw() as DatabaseSync;

  // 2. Concrete adapters
  const configRepo = new FileConfigRepository(opts?.configPath ?? FileConfigRepository.defaultPath());
  const broadcaster = new WebsocketBroadcaster();
  const logStore = new FsFileLogStore();
  const sessionRoot = new DefaultSessionRootProvider();
  const heartbeatProbe = new PiSessionHeartbeatProbe(sessionRoot);
  const processRunner = new NodeProcessRunner();
  const gitInspector = new SimpleGitInspector();
  const extrasCollector = new FsExtrasCollector();
  const skipNamesProvider = makeSkipNames(configRepo);
  const repoLister = new DirectoryRepoLister(skipNamesProvider);
  const pullExecutor = new ChildProcessPullExecutor(logStore);

  // 3. Repositories
  const repoRepo = new SqliteRepoRepository(db);
  const scanRepo = new SqliteScanRepository(db);

  // 4. App-level state
  const progress = new ScanProgressTracker();
  const jobRegistry = new JobRegistry();

  // 5. Services (with circular-aware construction via refs)
  const scanService = new ScanService(
    repoRepo,
    scanRepo,
    gitInspector,
    repoLister,
    extrasCollector,
    progress,
    configRepo,
    broadcaster,
  );

  const jobService = new JobService(
    repoRepo,
    jobRegistry,
    configRepo,
    broadcaster,
    logStore,
    heartbeatProbe,
    processRunner,
    async (repoPath, lastError) => scanService.refreshRepo(repoPath, lastError),
  );

  const repoService = new RepoService(
    repoRepo,
    configRepo,
    jobRegistry,
    gitInspector,
    pullExecutor,
    scanService,
    (job) => jobService.startJob(job),
  );

  const configService = new ConfigService(configRepo);
  const heartbeatService = new HeartbeatService(heartbeatProbe);

  return {
    db,
    connection,
    configRepo,
    broadcaster,
    logStore,
    heartbeatProbe,
    processRunner,
    gitInspector,
    extrasCollector,
    repoLister,
    pullExecutor,
    repoRepo,
    scanRepo,
    progress,
    jobRegistry,
    scanService,
    jobService,
    repoService,
    configService,
    heartbeatService,
    sessionRoot,
  };
}
