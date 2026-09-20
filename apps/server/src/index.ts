import { existsSync } from 'node:fs';
import { WebSocketServer } from 'ws';
import { createApp, findIndexHtml } from './app.js';
import { defaultDbPath, openDb, needsCommitStatsBackfill, markCommitStatsBackfilled, lastScanRootDir } from './db.js';
import { initOptimizer, notifyEvent } from './optimizer.js';
import { scanRoot } from './scanner.js';

const PORT = process.env.PORT || 3000;
const dbPath = process.env.REPOAGENT_DB || defaultDbPath();
const db = openDb(dbPath);
const app = createApp(db);
const indexHtml = findIndexHtml();

const server = app.listen(PORT, () => {
  console.log(`RepoAgent server listening on http://localhost:${PORT}`);
  console.log(`DB: ${dbPath}`);
  console.log(indexHtml ? `UI: ${indexHtml}` : 'UI: no index.html (GET / will 404 until web/public or web/dist exists)');
});

// issue #3：WS 推播 scan:done / job:log / job:done（與 HTTP 同埠）
const wss = new WebSocketServer({ server });
initOptimizer(wss, db);
console.log('WS: attached');

// 舊庫升級：commit 時間窗欄位為 migration 預設 0，需重新掃描回填一次，否則排行只會顯示「總計」。
// 回填對象用「本 DB 最後一次掃描的 rootDir」，而非共用 config，避免複製／測試 DB 誤掃真實目錄。
if (needsCommitStatsBackfill(db)) {
  const rootDir = lastScanRootDir(db);
  const hasRepos = (db.prepare('SELECT COUNT(*) AS n FROM repos').get() as { n: number }).n > 0;
  if (hasRepos && rootDir && existsSync(rootDir)) {
    console.log(`背景回填 commit 時間窗統計：${rootDir}`);
    scanRoot(db, rootDir)
      .then((summary) => {
        markCommitStatsBackfilled(db);
        notifyEvent('scan:done', { ...summary });
        console.log(`背景回填完成：${summary.okCount}/${summary.total} 個專案`);
      })
      .catch((e) => console.error('背景回填失敗，將於下次啟動重試：', e));
  } else {
    markCommitStatsBackfilled(db);
  }
}
