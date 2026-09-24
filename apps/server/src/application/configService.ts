/**
 * ConfigService — 讀寫設定。
 */
import type { ConfigStore } from '../domain/config.js';
import { InvalidPromptError, InvalidSkipDirsError } from '../domain/errors.js';
import type { IConfigRepository } from '../domain/ports.js';

export class ConfigService {
  constructor(private readonly repo: IConfigRepository) {}

  snapshot(): ConfigStore {
    return this.repo.snapshot();
  }

  patch(updates: Record<string, unknown>): ConfigStore {
    if (updates.rootDir !== undefined) {
      const normalized = this.repo.setRootDir(String(updates.rootDir));
      updates = { ...updates, rootDir: normalized };
    }
    if (updates.piPath !== undefined) {
      this.repo.setPiPath(String(updates.piPath));
    }
    if (updates.promptTemplates !== undefined) {
      try {
        const parsed = this.repo.setPromptTemplates(updates.promptTemplates);
        this.repo.patch({ promptTemplates: parsed });
      } catch (e) {
        throw new InvalidPromptError(String((e as Error).message || e));
      }
    }
    if (updates.activePromptId !== undefined) {
      this.repo.setActivePromptId(updates.activePromptId);
    }
    if (updates.promptTemplate !== undefined && updates.promptTemplates === undefined) {
      try {
        this.repo.setPromptTemplateBody(updates.promptTemplate);
      } catch (e) {
        throw new InvalidPromptError(String((e as Error).message || e));
      }
    }
    if (updates.timeout !== undefined) {
      this.repo.setTimeout(updates.timeout);
    }
    if (updates.piConcurrency !== undefined) {
      this.repo.setPiConcurrency(updates.piConcurrency);
    }
    if (updates.scanRecursive !== undefined) {
      this.repo.setScanRecursive(updates.scanRecursive);
    }
    if (updates.scanDepth !== undefined) {
      this.repo.setScanDepth(updates.scanDepth);
    }
    if (updates.skipDirs !== undefined) {
      try {
        const parsed = this.repo.setSkipDirs(updates.skipDirs);
        this.repo.patch({ skipDirs: parsed });
      } catch (e) {
        throw new InvalidSkipDirsError(String((e as Error).message || e));
      }
    }
    if (updates.extrasEnabled !== undefined) {
      this.repo.setExtrasEnabled(updates.extrasEnabled);
    }
    this.repo.save();
    return this.repo.snapshot();
  }
}
