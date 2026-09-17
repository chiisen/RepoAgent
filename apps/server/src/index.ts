import { WebSocketServer } from 'ws';
import { createApp, findIndexHtml } from './app.js';
import { defaultDbPath, openDb } from './db.js';
import { initOptimizer } from './optimizer.js';

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
