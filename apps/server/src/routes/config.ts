import { Router, Request, Response } from 'express';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { configStore, saveConfig, normalizeRootDir, ensurePromptTemplates, parsePromptTemplates } from '../config.js';

export function createConfigRouter() {
  const router = Router();

  router.get('/', (req: Request, res: Response) => {
    ensurePromptTemplates(configStore);
    res.json({
      rootDir: configStore.rootDir,
      piPath: configStore.piPath,
      promptTemplate: configStore.promptTemplate,
      promptTemplates: configStore.promptTemplates,
      activePromptId: configStore.activePromptId,
      timeout: configStore.timeout,
      piConcurrency: configStore.piConcurrency,
    });
  });

  router.put('/', (req: Request, res: Response) => {
    const { rootDir, piPath, promptTemplate, promptTemplates, activePromptId, timeout, piConcurrency } = req.body;

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
    if (promptTemplates !== undefined) {
      try {
        configStore.promptTemplates = parsePromptTemplates(promptTemplates);
      } catch (e) {
        return res.status(400).json({ error: String((e as Error).message || e) });
      }
    }
    if (activePromptId !== undefined) {
      configStore.activePromptId = String(activePromptId);
    }
    if (promptTemplate !== undefined && promptTemplates === undefined) {
      ensurePromptTemplates(configStore);
      const active = configStore.promptTemplates.find((t) => t.id === configStore.activePromptId);
      if (active) active.body = String(promptTemplate);
      configStore.promptTemplate = String(promptTemplate);
    }
    ensurePromptTemplates(configStore);
    if (timeout !== undefined) {
      const n = Number(timeout);
      if (!Number.isInteger(n) || n < 60 || n > 7200) {
        return res.status(400).json({ error: `timeout must be an integer 60..7200 (seconds), got: ${timeout}` });
      }
      configStore.timeout = n;
    }
    if (piConcurrency !== undefined) {
      const n = Number(piConcurrency);
      if (!Number.isInteger(n) || n < 1 || n > 4) {
        return res.status(400).json({ error: `piConcurrency must be an integer 1..4, got: ${piConcurrency}` });
      }
      configStore.piConcurrency = n;
    }

    saveConfig();
    res.json({
      rootDir: configStore.rootDir,
      piPath: configStore.piPath,
      promptTemplate: configStore.promptTemplate,
      promptTemplates: configStore.promptTemplates,
      activePromptId: configStore.activePromptId,
      timeout: configStore.timeout,
      piConcurrency: configStore.piConcurrency,
    });
  });

  return router;
}
