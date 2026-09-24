/**
 * Express app 組合（薄殼）。所有服務由 composition root 注入。
 *
 * 雙重簽名以向後相容：
 * - `createApp(container)` — 新建構子注入（首選）
 * - `createApp(db)`       — 舊版（測試相容）
 * - `createApp()`         — 不傳參：沿用 container 預設 db
 */

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import express, { type Express } from 'express';

import { sharedContainer } from './composition/_sharedContainer.js';
import type { Container } from './composition/container.js';
import { createServicesForDb } from './composition/container.js';
import { createConfigRouter } from './routes/_internal/config.js';
import { createJobsRouter } from './routes/_internal/jobs.js';
import { createReposRouter } from './routes/_internal/repos.js';
import { createScanRouter } from './routes/_internal/scan.js';

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

export function createApp(containerOrDb?: Container | DatabaseSync): Express {
  const services =
    containerOrDb === undefined
      ? sharedContainer()
      : containerOrDb && typeof (containerOrDb as Container).scanService === 'object'
        ? (containerOrDb as Container)
        : createServicesForDb(containerOrDb as DatabaseSync);

  const app = express();
  app.use(express.json());

  app.use('/api', createReposRouter(services.repoService));
  app.use('/api', createScanRouter(services.scanService, services.progress));
  app.use('/api/config', createConfigRouter(services.configService));
  app.use('/api', createJobsRouter(services.jobService));

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
