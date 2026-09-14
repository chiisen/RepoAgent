import express from 'express';
import { join } from 'node:path';
import { openDb } from './db.js';
import { createReposRouter } from './routes/repos.js';
import { createScanRouter } from './routes/scan.js';
import { createJobsRouter } from './routes/jobs.js';

const app = express();
const PORT = process.env.PORT || 3000;

const db = openDb(':memory:');

app.use(express.json());
app.use('/api', createReposRouter(db));
app.use('/api', createScanRouter(db));
app.use('/api', createJobsRouter());

// Serve static frontend files
const publicDir = join(__dirname, '..', '..', 'web', 'dist');
app.use(express.static(publicDir));

app.listen(PORT, () => {
  console.log(`RepoAgent server listening on http://localhost:${PORT}`);
});