import { Router, Request, Response } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { scanRoot } from '../scanner.js';

export function createScanRouter(db: DatabaseSync): Router {
  const router = Router();

  router.post('/scan', async (req: Request, res: Response) => {
    const { rootDir } = req.body;
    if (!rootDir) return res.status(400).json({ error: 'rootDir required' });
    try {
      const summary = await scanRoot(db, rootDir);
      res.json(summary);
    } catch (e) {
      res.status(400).json({ error: String(e) });
    }
  });

  return router;
}