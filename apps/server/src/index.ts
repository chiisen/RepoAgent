/**
 * Entry point（薄殼）：組裝 DI container、掛上 WS、開背景回填。
 */
import { existsSync } from 'node:fs';
import { WebSocketServer } from 'ws';

import { createApp, findIndexHtml } from './app.js';
import { createContainer } from './composition/container.js';
import {
  defaultDbPath,
  lastScanRootDir,
  markCommitStatsBackfilled,
  needsCommitStatsBackfill,
} from './infrastructure/sqlite/connection.js';

const PORT = Number(process.env.PORT) || 3000;
const dbPath = process.env.REPOAGENT_DB || defaultDbPath();

const container = createContainer({ dbPath: process.env.REPOAGENT_DB });
const app = createApp(container);
const indexHtml = findIndexHtml();

const server = app.listen(PORT, () => {
  console.log(`RepoAgent server listening on http://localhost:${PORT}`);
  console.log(`DB: ${dbPath}`);
  console.log(
    indexHtml ? `UI: ${indexHtml}` : 'UI: no index.html (GET / will 404 until web/public or web/dist exists)',
  );
});

// WS broadcast
const wss = new WebSocketServer({ server });
container.broadcaster.attach(wss as unknown as { clients?: Iterable<unknown> });
console.log('WS: attached');

// 舊庫升級：commit 時間窗欄位為 migration 預設 0，需重新掃描回填一次，否則排行只會顯示「總計」。
if (needsCommitStatsBackfill(container.db)) {
  const rootDir = lastScanRootDir(container.db);
  const hasRepos = (container.db.prepare('SELECT COUNT(*) AS n FROM repos').get() as { n: number }).n > 0;
  if (hasRepos && rootDir && existsSync(rootDir)) {
    console.log(`背景回填 commit 時間窗統計：${rootDir}`);
    container.scanService
      .scanRoot(rootDir)
      .then((summary) => {
        markCommitStatsBackfilled(container.db);
        console.log(`背景回填完成：${summary.okCount}/${summary.total} 個專案`);
      })
      .catch((e) => console.error('背景回填失敗，將於下次啟動重試：', e));
  } else {
    markCommitStatsBackfilled(container.db);
  }
}
