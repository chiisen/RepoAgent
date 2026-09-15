import express from 'express';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { createReposRouter } from './routes/repos.js';
import { createScanRouter } from './routes/scan.js';
import { createConfigRouter } from './routes/config.js';
import { createJobsRouter } from './routes/jobs.js';

// ESM 下無 __dirname，以 import.meta.url 推導（Windows/macOS 通用）
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

const db = openDb(':memory:');

app.use(express.json());
app.use('/api', createReposRouter(db));
app.use('/api', createScanRouter(db));
app.use('/api/config', createConfigRouter());

app.use('/api', createJobsRouter());

function findIndexHtml(): string | undefined {
  const candidates = [
    join(__dirname, '..', '..', 'web', 'dist', 'index.html'),
    join(__dirname, '..', '..', 'web', 'public', 'index.html'),
    join(process.cwd(), 'apps', 'web', 'dist', 'index.html'),
    join(process.cwd(), 'apps', 'web', 'public', 'index.html'),
    join(process.cwd(), '..', 'web', 'public', 'index.html'),
  ];
  return candidates.find((p) => existsSync(p));
}

const indexHtml = findIndexHtml();
if (indexHtml) {
  const webDir = dirname(indexHtml);
  const faviconSvg = join(webDir, 'favicon.svg');
  app.get('/favicon.ico', (_req, res) => {
    if (existsSync(faviconSvg)) return res.type('image/svg+xml').sendFile(faviconSvg);
    res.status(204).end();
  });
  app.use(express.static(webDir));
  app.get('/', (_req, res) => res.sendFile(indexHtml));
}

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`RepoAgent server listening on http://localhost:${PORT}`);
  console.log(indexHtml ? `UI: ${indexHtml}` : 'UI: no index.html (GET / will 404 until web/public or web/dist exists)');
});
