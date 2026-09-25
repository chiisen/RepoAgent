/**
 * /api/scan 系列 Controller。
 */
import { type Request, type Response, Router } from 'express';
import type { ScanService } from '../../application/scanService.js';
import { RootDirNotFoundError } from '../../domain/errors.js';
import type { IScanProgressTracker } from '../../domain/ports.js';

export function createScanRouter(
  scanService: Pick<ScanService, 'scanRoot'>,
  progress: Pick<IScanProgressTracker, 'get'>,
): Router {
  const router = Router();

  router.get('/scan/progress', (_req: Request, res: Response) => {
    res.json(progress.get());
  });

  router.post('/scan', async (req: Request, res: Response) => {
    const { rootDir } = req.body;
    if (!rootDir) return res.status(400).json({ error: 'rootDir required' });
    try {
      const summary = await scanService.scanRoot(String(rootDir));
      res.json(summary);
    } catch (e) {
      if (e instanceof RootDirNotFoundError) {
        return res.status(400).json({ error: (e as Error).message });
      }
      res.status(400).json({ error: String((e as Error).message || e) });
    }
  });

  return router;
}
