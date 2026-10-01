/**
 * Express app 組合（薄殼）。所有服務由 composition root 注入。
 *
 * 兩個明確入口：
 * - `createApp(container)` — 建構子注入（省略時沿用 sharedContainer）
 * - `createAppWithDb(db)`  — 以既有 DB 建立一次性服務（測試用）
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

/** 無 dist 時的頁面。不是 Express 預設 404。 */
export const NEED_BUILD_HTML = `<!doctype html>
<html lang="zh-Hant">
<head><meta charset="utf-8"><title>RepoAgent</title></head>
<body><p>RepoAgent 尚未建置前端。請在專案根目錄執行 <code>npm run build</code> 後重新啟動。</p></body>
</html>
`;

export function indexHtmlCandidates(compiledWebDir: string, cwd: string): string[] {
  return [
    join(compiledWebDir, 'dist', 'index.html'),
    join(cwd, 'apps', 'web', 'dist', 'index.html'),
    join(cwd, 'web', 'dist', 'index.html'),
  ];
}

export function findIndexHtml(): string | undefined {
  return indexHtmlCandidates(join(__dirname, '..', '..', 'web'), process.cwd()).find((p) => existsSync(p));
}

export function createApp(container: Container = sharedContainer()): Express {
  const services = container;

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
  } else {
    app.get('/favicon.ico', (_req, res) => res.status(204).end());
    app.get('/', (_req, res) => res.type('html').send(NEED_BUILD_HTML));
  }

  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  return app;
}

/** 以既有 DB 建立一次性 container 的 app（測試用）。 */
export function createAppWithDb(db: DatabaseSync): Express {
  return createApp(createServicesForDb(db));
}
