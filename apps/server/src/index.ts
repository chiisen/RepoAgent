import express from 'express';
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

// Serve static frontend files
const publicDir = join(__dirname, '..', '..', 'web', 'dist');
app.use(express.static(publicDir));

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`RepoAgent server listening on http://localhost:${PORT}`);
});
