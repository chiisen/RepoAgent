import express from 'express';
import { join } from 'node:path';
import { openDb } from './db.js';
import { createReposRouter } from './routes/repos.js';
import { createScanRouter } from './routes/scan.js';
import { createJobsRouter } from './routes/jobs.js';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use('/api', createReposRouter(openDb(':memory:')));
app.use('/api', createScanRouter(openDb(':memory:')));
app.use('/api', createJobsRouter());

// Serve static frontend files
const publicDir = join(__dirname, '..', '..', 'web', 'dist');
app.use(express.static(publicDir));

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`RepoAgent server listening on http://localhost:${PORT}`);
});