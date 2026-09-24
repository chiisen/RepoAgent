/**
 * Shim: config.ts — 保留舊 module-level `configStore` 與所有 helper 函式。
 */
import * as path from 'node:path';
import { sharedContainer } from '../composition/_sharedContainer.js';
import type { ConfigStore } from '../domain/config.js';
import {
  ensurePromptTemplates as _ensurePromptTemplates,
  fillPrompt as _fillPrompt,
  parsePromptTemplates as _parsePromptTemplates,
  parseSkipDirs as _parseSkipDirs,
  CONFIG_DEFAULTS,
} from '../domain/config.js';

export const defaults = CONFIG_DEFAULTS;
export type { ConfigStore, PromptTemplate } from '../domain/types.js';
export const ensurePromptTemplates = _ensurePromptTemplates;
export const parsePromptTemplates = _parsePromptTemplates;
export const parseSkipDirs = _parseSkipDirs;
export const fillPrompt = _fillPrompt;
export const resolveOptimizePrompt = (
  repoPath: string,
  branch: string,
  body: { prompt?: unknown; promptId?: unknown },
): { prompt: string; promptId: string } => {
  const snap = sharedContainer().configRepo.snapshot();
  const custom = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  if (custom) return { prompt: _fillPrompt(custom, repoPath, branch), promptId: 'custom' };
  const id =
    typeof body.promptId === 'string' && body.promptId.trim() ? body.promptId.trim() : snap.activePromptId;
  const t = snap.promptTemplates.find((x) => x.id === id);
  if (!t) throw new Error(`unknown promptId: ${id}`);
  return { prompt: _fillPrompt(t.body, repoPath, branch), promptId: t.id };
};

export const normalizeRootDir = (input: string): string => {
  const trimmed = input.trim();
  if (!trimmed) return trimmed;
  const resolved = path.resolve(trimmed);
  const { root } = path.parse(resolved);
  if (resolved === root) return resolved;
  return resolved.replace(/[\\/]+$/, '');
};

export const loadConfig = (): ConfigStore => sharedContainer().configRepo.snapshot();
export const saveConfig = (): void => sharedContainer().configRepo.save();

/** 舊 module-level mutable configStore（測試會 mutate；用 getter 拿當前 snapshot）。 */
export const configStore: ConfigStore = new Proxy({} as ConfigStore, {
  get(_target, prop) {
    const snap = sharedContainer().configRepo.snapshot();
    return Reflect.get(snap, prop);
  },
  set(_target, prop, value) {
    sharedContainer().configRepo.patch({ [prop as string]: value });
    return true;
  },
});
