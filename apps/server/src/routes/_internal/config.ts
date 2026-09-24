/**
 * /api/config 系列 Controller。
 */
import { type Request, type Response, Router } from 'express';

import type { ConfigService } from '../../application/configService.js';
import { InvalidPromptError, InvalidSkipDirsError, RootDirNotFoundError } from '../../domain/errors.js';

function toClient(snap: ReturnType<ConfigService['snapshot']>): Record<string, unknown> {
  return {
    rootDir: snap.rootDir,
    piPath: snap.piPath,
    promptTemplate: snap.promptTemplate,
    promptTemplates: snap.promptTemplates,
    activePromptId: snap.activePromptId,
    timeout: snap.timeout,
    piConcurrency: snap.piConcurrency,
    scanRecursive: snap.scanRecursive === true,
    scanDepth: snap.scanDepth,
    skipDirs: Array.isArray(snap.skipDirs) ? snap.skipDirs : [],
    extrasEnabled: snap.extrasEnabled === true,
  };
}

export function createConfigRouter(service: Pick<ConfigService, 'snapshot' | 'patch'>): Router {
  const router = Router();

  router.get('/', (_req: Request, res: Response) => {
    res.json(toClient(service.snapshot()));
  });

  router.put('/', (req: Request, res: Response) => {
    try {
      const updated = service.patch(req.body || {});
      res.json(toClient(updated));
    } catch (e) {
      if (e instanceof RootDirNotFoundError) {
        return res.status(400).json({ error: (e as Error).message });
      }
      if (e instanceof InvalidPromptError || e instanceof InvalidSkipDirsError) {
        return res.status(400).json({ error: (e as Error).message });
      }
      res.status(400).json({ error: String((e as Error).message || e) });
    }
  });

  return router;
}
