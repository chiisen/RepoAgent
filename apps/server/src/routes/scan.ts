import { Router, Request, Response } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { getScanProgress, scanRoot } from '../scanner.js';
import { notifyEvent } from '../optimizer.js';

export function createScanRouter(db: DatabaseSync): Router {
  const router = Router();

  router.get('/scan/progress', (_req: Request, res: Response) => {
    res.json(getScanProgress());
  });

  router.post('/scan', async (req: Request, res: Response) => {
    const { rootDir } = req.body;
    if (!rootDir) return res.status(400).json({ error: 'rootDir required' });
    try {
      const summary = await scanRoot(db, rootDir);
      notifyEvent('scan:done', { ...summary });
      res.json(summary);
    } catch (e) {
      res.status(400).json({ error: String(e) });
    }
  });

  return router;
}