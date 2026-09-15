import { createApp, findIndexHtml } from './app.js';
import { defaultDbPath, openDb } from './db.js';

const PORT = process.env.PORT || 3000;
const dbPath = process.env.REPOAGENT_DB || defaultDbPath();
const app = createApp(openDb(dbPath));
const indexHtml = findIndexHtml();

app.listen(PORT, () => {
  console.log(`RepoAgent server listening on http://localhost:${PORT}`);
  console.log(`DB: ${dbPath}`);
  console.log(indexHtml ? `UI: ${indexHtml}` : 'UI: no index.html (GET / will 404 until web/public or web/dist exists)');
});
