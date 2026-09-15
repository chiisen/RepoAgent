import express, { type Express } from 'express';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { createReposRouter } from './routes/repos.js';
import { createScanRouter } from './routes/scan.js';
import { createConfigRouter } from './routes/config.js';
import { createJobsRouter } from './routes/jobs.js';
import type { DatabaseSync } from 'node:sqlite';

const __dirname = dirname(fileURLToPath(import.meta.url));

export function findIndexHtml(): string | undefined {
  const candidates = [
    join(__dirname, '..', '..', 'web', 'dist', 'index.html'),
    join(__dirname, '..', '..', 'web', 'public', 'index.html'),
    join(process.cwd(), 'apps', 'web', 'dist', 'index.html'),
    join(process.cwd(), 'apps', 'web', 'public', 'index.html'),
    join(process.cwd(), '..', 'web', 'public', 'index.html'),
  ];
  return candidates.find((p) => existsSync(p));
}

export function createApp(db: DatabaseSync = openDb(':memory:')): Express {
  const app = express();
  app.use(express.json());
  app.use('/api', createReposRouter(db));
  app.use('/api', createScanRouter(db));
  app.use('/api/config', createConfigRouter());
  app.use('/api', createJobsRouter());

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
  return app;
}
