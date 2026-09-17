import { Router, Request, Response } from 'express';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { configStore, saveConfig, normalizeRootDir } from '../config.js';

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
        const normalized = normalizeRootDir(rootDir);
        if (!normalized || !fs.existsSync(normalized)) {
          return res.status(400).json({ error: `rootDir not found: ${rootDir}` });
        }
        req.body.rootDir = normalized;
      } catch {
        return res.status(400).json({ error: `invalid rootDir: ${rootDir}` });
      }
    }

    if (piPath !== undefined) {
      if (piPath !== 'pi' && !path.isAbsolute(piPath)) {
        return res.status(400).json({ error: `piPath must be 'pi' or an absolute path, got: ${piPath}` });
      }
    }

    if (rootDir !== undefined) configStore.rootDir = req.body.rootDir as string;
    if (piPath !== undefined) configStore.piPath = piPath;
    if (promptTemplate !== undefined) configStore.promptTemplate = promptTemplate;
    if (timeout !== undefined) {
      const n = Number(timeout);
      if (!Number.isInteger(n) || n < 60 || n > 7200) {
        return res.status(400).json({ error: `timeout must be an integer 60..7200 (seconds), got: ${timeout}` });
      }
      configStore.timeout = n;
    }

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
