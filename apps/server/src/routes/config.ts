import { Router, Request, Response } from 'express';
import { configStore, loadConfig, saveConfig } from '../config.js';

export function createConfigRouter() {
  const router = Router();

  router.get('/', (req: Request, res: Response) => {
    res.json({
      rootDir: configStore.rootDir,
      piPath: configStore.piPath,
      promptTemplate: configStore.promptTemplate,
      timeout: configStore.timeout,
    });
  });

  router.put('/', (req: Request, res: Response) => {
    const { rootDir, piPath, promptTemplate, timeout } = req.body;

    if (rootDir !== undefined) {
      try {
        require('node:path').resolve(rootDir);
        if (!require('node:fs').existsSync(rootDir)) {
          return res.status(400).json({ error: `rootDir not found: ${rootDir}` });
        }
      } catch {
        return res.status(400).json({ error: `invalid rootDir: ${rootDir}` });
      }
    }

    if (piPath !== undefined) {
      if (piPath !== 'pi' && !require('node:path').isAbsolute(piPath)) {
        return res.status(400).json({ error: `piPath must be 'pi' or an absolute path, got: ${piPath}` });
      }
    }

    if (rootDir !== undefined) configStore.rootDir = rootDir;
    if (piPath !== undefined) configStore.piPath = piPath;
    if (promptTemplate !== undefined) configStore.promptTemplate = promptTemplate;
    if (timeout !== undefined) configStore.timeout = timeout;

    saveConfig();
    res.json({
      rootDir: configStore.rootDir,
      piPath: configStore.piPath,
      promptTemplate: configStore.promptTemplate,
      timeout: configStore.timeout,
    });
  });

  return router;
}